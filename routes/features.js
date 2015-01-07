// feature routes
module.exports = function(app, auth) {

  var api = require('../api')
    , fs = require('fs-extra')
    , util = require('util')
    , moment = require('moment')
    , access = require('../access')
    , geometryFormat = require('../format/geoJsonFormat')
    , geojson = require('../transformers/geojson');

  var sortColumnWhitelist = ["lastModified"];

  var getFeatureResource = function(req) {
      return req.getPath().match(/(.*features)/)[0];
  }

  var validateFeature = function(req, res, next) {
    var feature = req.body;

    if (!feature.type || feature.type != 'Feature' ) {
      return res.send(400, "cannot create feature 'type' param not specified, or is not set to 'Feature'");
    }

    if (!feature.geometry) {
      return res.send(400, "cannot create feature 'geometry' param not specified");
    }

    if (!feature.properties || !feature.properties.timestamp) {
      return res.send(400, "cannot create feature 'properties.timestamp' param not specified");
    }

    feature.properties.timestamp = moment(feature.properties.timestamp).toDate();

    var state = {name: 'active'};
    if (userId) state.userId = userId;
    feature.states = [state];

    req.newFeature = {
      type: feature.type,
      geometry: feature.geometry,
      properties: feature.properties,
      states: [state]
    };

    var userId = req.user ? req.user._id : null;
    if (userId) req.newFeature.userId = userId;

    var deviceId = req.provisionedDeviceId ? req.provisionedDeviceId : null;
    if (deviceId) req.newFeature.deviceId = deviceId;

    next();
  }

  var parseQueryParams = function(req, res, next) {
    // setup defaults
    var parameters = {
      filter: {
      }
    };

    var fields = req.param('fields');
    if (fields) {
      parameters.fields = JSON.parse(fields);
    }

    var startDate = req.param('startDate');
    if (startDate) {
      parameters.filter.startDate = moment(startDate).utc().toDate();
    }

    var endDate = req.param('endDate');
    if (endDate) {
      parameters.filter.endDate = moment(endDate).utc().toDate();
    }

    var bbox = req.param('bbox');
    if (bbox) {
      parameters.filter.geometries = geometryFormat.parse('bbox', bbox);
    }

    var geometry = req.param('geometry');
    if (geometry) {
      parameters.filter.geometries = geometryFormat.parse('geometry', geometry);
    }

    var states = req.param('states');
    if (states) {
      parameters.filter.states = states.split(',');
    }

    var sort = req.param('sort');
    if (sort) {
      var columns = {};
      sort.split(',').forEach(function(column) {
        var sortParams = column.split('+');
        // Check sort column is in whitelist
        if (sortColumnWhitelist.indexOf(sortParams[0]) == -1) return res.send("Cannot sort on column '" + sortParams[0] + "'");

        // Order can be nothing (ASC by default) or ASC, DESC
        var direction = 1; //ASC
        if (sortParams.length > 1 && sortParams[1] == 'DESC') {
          direction = -1; // DESC
        }

        columns[sortParams[0]] = direction;
      });
      parameters.sort = columns;
    }

    req.parameters = parameters;

    next();
  }

  // Queries for ESRI Styled records built for the ESRI format and syntax
  app.get(
    '/FeatureServer/:layerId/features',
    access.authorize('READ_FEATURE'),
    parseQueryParams,
    function (req, res) {
      console.log("MAGE ESRI Features GET REST Service Requested");

      var options = {
        filter: req.parameters.filter,
        fields: req.parameters.fields,
        sort: req.parameters.sort
      };
      new api.Feature(req.layer).getAll(options, function(features) {
        var features = geojson.transform(features, {path: getFeatureResource(req)});
        res.json({
          type: "FeatureCollection",
          bbox: [-180, -90, 180, 90.0],
          features: features
        });
      });
    }
  );

  // This function gets one feature with universal JSON formatting
  app.get(
    '/FeatureServer/:layerId/features/:id',
    access.authorize('READ_FEATURE'),
    parseQueryParams,
    function (req, res) {
      console.log("MAGE Features (ID) GET REST Service Requested");

      var options = {fields: req.parameters.fields};
      new api.Feature(req.layer).getById(req.param('id'), options, function(feature) {
        var response = geojson.transform(feature, {path: getFeatureResource(req)});
        res.json(response);
      });
    }
  );

  // This function creates a new Feature
  app.post(
    '/FeatureServer/:layerId/features',
    access.authorize('CREATE_FEATURE'),
    validateFeature,
    function (req, res) {
      console.log("MAGE Features POST REST Service Requested");

      new api.Feature(req.layer).create(req.newFeature, function(newFeature) {
        if (!newFeature) return res.send(400);

        var response = geojson.transform(newFeature, {path: getFeatureResource(req)});
        res.location(newFeature._id.toString()).json(response);
      }
    );
  });

  // This function will update a feature by the ID
  app.put(
    '/FeatureServer/:layerId/features/:id',
    access.authorize('UPDATE_FEATURE'),
    function (req, res) {
      console.log("MAGE Features (ID) UPDATE REST Service Requested");

      var feature = {};
      if (req.body.geometry) feature.geometry = req.body.geometry;
      if (req.body.properties) {
        feature.properties = req.body.properties;
        if (!feature.properties.type) {
          return res.send(400, "cannot create feature 'properties.type' param not specified");
        }

        if (!feature.properties.timestamp) {
          return res.send(400, "cannot create feature 'properties.timestamp' param not specified");
        }

        feature.properties.timestamp = moment(feature.properties.timestamp).toDate();
      }

      var userId = req.user ? req.user._id : null;
      if (userId) feature.userId = userId;

      var deviceId = req.provisionedDeviceId ? req.provisionedDeviceId : null;
      if (deviceId) feature.deviceId = deviceId;

      new api.Feature(req.layer).update(req.param('id'), feature, function(err, updatedFeature) {
        var response = geojson.transform(updatedFeature, {path: getFeatureResource(req)});
        res.json(response);
      }
    );
  });

  app.post(
    '/FeatureServer/:layerId/features/:id/states',
    access.authorize('UPDATE_FEATURE'),
    function(req, res, next) {
      console.log('got body: ', req.body);

      var state = req.body;
      if (!state) return res.send(400);
      if (!state.name) return res.send(400, 'name required');
      if (state.name != 'active' && state.name != 'complete' && state.name != 'archive') {
        return res.send(400, "state name must be one of 'active', 'complete', 'archive'");
      }

      state = { name: state.name };
      if (req.user) state.userId = req.user._id;

      new api.Feature(req.layer).addState(req.param('id'), state, function(err, feature) {
        if (err) {
          return res.send(400, 'state is already ' + "'" + state.name + "'");
        }

        var response = geojson.transform(feature, {path: getFeatureResource(req)});
        res.json(201, response);
      });
    }
  );

  app.get(
    '/FeatureServer/:layerId/features/:id/attachments',
    access.authorize('READ_FEATURE'),
    function(req, res, next) {
      var fields = {attachments: true};
      var options = {fields: fields};
      new api.Feature(req.layer).getById(req.param('id'), options, function(feature) {
        var response = geojson.transform(feature, {path: getFeatureResource(req)});
        res.json(response.attachments);
      });
    }
  );

  app.get(
    '/FeatureServer/:layerId/features/:featureId/attachments/:attachmentId',
    access.authorize('READ_FEATURE'),
    function(req, res, next) {
      console.log("MAGE Features (ID) Attachment GET REST Service Requested");

      new api.Attachment(req.layer, req.feature).getById(req.param('attachmentId'), {size: req.param('size')}, function(err, attachment) {
        if (err) return next(err);

        if (!attachment) return res.send(404);

        var stream;
        if (req.headers.range) {
          var range = req.headers.range;
          var rangeParts = range.replace(/bytes=/, "").split("-");
          var rangeStart = parseInt(rangeParts[0], 10);
          var rangeEnd = rangeParts[1] ? parseInt(rangeParts[1], 10) : attachment.size - 1;
          var contentLength = (rangeEnd - rangeStart) + 1;

          res.writeHead(206, {
            'Content-Range': 'bytes ' + rangeStart + '-' + rangeEnd + '/' + attachment.size,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': attachment.contentType
          });
          stream = fs.createReadStream(attachment.path, {start: rangeStart, end: rangeEnd});
        } else {
          res.writeHead(200, {
            'Content-Length': attachment.size,
            'Content-Type': attachment.contentType
          });
          stream = fs.createReadStream(attachment.path);
        }

        stream.on('open', function() {
          stream.pipe(res);
        });
        stream.on('error', function(err) {
          console.log('error', err);
          res.send(404);
        });
      });
    }
  );

  // This function will add an attachment for a particular observation
  app.post(
    '/FeatureServer/:layerId/features/:featureId/attachments',
    access.authorize('CREATE_FEATURE'),
    function(req, res, next) {
      console.log("MAGE Attachment POST REST Service Requested");

      var attachment = req.files.attachment;
      if (!attachment) return res.send(400, "no attachment");

      new api.Attachment(req.layer, req.feature).create(req.featureId, req.files.attachment, function(err, attachment) {
        if (err) return next(err);

        var feature = req.feature;
        feature.attachments = [attachment.toObject()];
        return res.json(geojson.transform(feature, {path: getFeatureResource(req)}).attachments[0]);
      });
    }
  );

  // This function will update the specified attachment
  app.put(
    '/FeatureServer/:layerId/features/:featureId/attachments/:attachmentId',
    access.authorize('UPDATE_FEATURE'),
    function(req, res, next) {
      console.log("MAGE Attachment UPDATE REST Service Requested");

      new api.Attachment(req.layer, req.feature).update(req.featureId, req.files.attachment, function(err, attachment) {
        if (err) return next(err);

        var feature = req.feature;
        feature.attachments = [attachment.toObject()];
        return res.json(geojson.transform(feature, {path: getFeatureResource(req)}).attachments[0]);
      });
    }
  );

  // This function will delete all attachments for the given list of attachment ids
  app.delete(
    '/FeatureServer/:layerId/features/:featureId/attachments/:attachmentId',
    access.authorize('DELETE_FEATURE'),
    function(req, res) {
      console.log("MAGE Attachment DELETE REST Service Requested");

      new api.Attachment(req.layer, req.feature).delete(req.param('attachmentId'), function(err) {
        res.send(200);
      });
    }
  );
}