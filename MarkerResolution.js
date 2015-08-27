define(function(require, exports, module) {
"use strict";

/**
* Data structure for quick fixes. Only for use within language handlers.
* 
* See {@link language.base_handler#getResolutions}.
* 
* @param {String} label short description, to be displayed in the list of resolutions
* @param {String} image image to be displayed in the list of resolutions
* @param {String} previewHtml
* @param {Object[]} deltas the changes to be applied
* @param {Object} pos the position where the cursor should be after applying
* 
* @class language.MarkerResolution
*/
var MarkerResolution = function(label, image, previewHtml, deltas, pos) {
    return {
        label: label,
        image: image,
        previewHtml: previewHtml,
        deltas: deltas,
        pos: pos
    };
}; 

exports.MarkerResolution = MarkerResolution;

});