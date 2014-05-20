'use strict';

mage.factory('FeatureTypeService', ['$http', 'appConstants', 'mageLib',
  function ($http, appConstants, mageLib) {
    var ***REMOVED*** = {};

    var types = $http.get('/api/feature/types', {
    	params: {
    		type: appConstants.deployment
    	}
    });
    ***REMOVED***.getTypes = function () {
      return types;
    };

    return ***REMOVED***;
  }]);
