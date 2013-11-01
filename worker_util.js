/*
 * Cloud9 Language Foundation
 *
 * @copyright 2013, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
 
/**
 * Worker utilities.
 * 
 * See {@link language}
 * 
 * @class language.worker_util
 */
define(function(require, exports, module) {

var worker = require("./worker");

var lastExecId = 0;
var lastReadId = 0;

module.exports = {

    /**
     * Utility function, used to determine whether a certain feature is enabled
     * in the user's preferences.
     * 
     * Should not be overridden by inheritors.
     * 
     * @param {String} name  The name of the feature, e.g. "unusedFunctionArgs"
     * @return {Boolean}
     */
    isFeatureEnabled: function(name) {
        /*global disabledFeatures*/
        return !disabledFeatures[name];
    },
    
    /**
     * Utility function, used to determine the identifier regex for the 
     * current language, by invoking {@link #getIdentifierRegex} on its handlers.
     * 
     * Should not be overridden by inheritors.
     * 
     * @param {Object} [pos] The position to determine the identifier regex of
     * @return {RegExp}
     */
    getIdentifierRegex: function(pos) {
        return worker.getIdentifierRegex(pos);
    },
    
    /**
     * Utility function, used to retrigger completion,
     * in case new information was collected and should
     * be displayed, and assuming the popup is still open.
     * 
     * Should not be overridden by inheritors.
     * 
     * @param {Object} pos   The position to retrigger this update
     * @param {String} line  The line that this update was triggered for
     */
    completeUpdate: function(pos) {
        return worker.completeUpdate(pos);
    },
    
    /**
     * Utility function, used to call {@link proc#execFile}
     * from the worker.
     * 
     * Should not be overridden by inheritors.
     * 
     * @see proc#execFile
     * 
     * @param {String}   path                             the path to the file to execute
     * @param {Object}   [options]
     * @param {Array}    [options.args]                   An array of args to pass to the executable.
     * @param {String}   [options.stdoutEncoding="utf8"]  The encoding to use on the stdout stream. Defaults to .
     * @param {String}   [options.stderrEncoding="utf8"]  The encoding to use on the stderr stream. Defaults to "utf8".
     * @param {String}   [options.cwd]                    Current working directory of the child process
     * @param {Array}    [options.stdio]                  Child's stdio configuration. (See above)
     * @param {Object}   [options.env]                    Environment key-value pairs
     * @param {String}   [options.encoding="utf8"]        
     * @param {Number}   [options.timeout=0]         
     * @param {Number}   [options.maxBuffer=200*1024]
     * @param {String}   [options.killSignal="SIGTERM"]
     * @param {Boolean}  [options.resumeStdin]            Start reading from stdin, so the process doesn't exit
     * @param {Boolean}  [options.resolve]                Resolve the path to the VFS root before executing file
     * @param {Function} callback 
     * @param {Error}    callback.error                   The error object if an error occurred.
     * @param {String}   callback.stdout                  The stdout buffer
     * @param {String}   callback.stderr                  The stderr buffer
     */
    execFile: function(path, options, callback) {
        var id = lastExecId++;
        var _self = this;
        worker.sender.emit("execFile", { path: path, options: options, id: id });
        worker.sender.on("execFileResult", function onExecFileResult(event) {
            if (event.data.id !== id)
                return;
            worker.sender.off("execFileResult", onExecFileResult);
            callback(event.data.err, event.data.stdout, event.data.stderr);
        });
    },
    
    /**
     * Reads the entire contents from a file in the workspace.
     * 
     * Example:
     * 
     *     fs.readFile('/config/server.js', function (err, data) {
     *         if (err) throw err;
     *         console.log(data);
     *     });
     * 
     * @param {String}   path           the path of the file to read
     * @param {Object}   [encoding]     the encoding of the content for the file
     * @param {Function} callback       called after the file is read
     * @param {Error}    callback.err   the error information returned by the operation
     * @param {String}   callback.data  the contents of the file that was read
     * @fires error
     * @fires downloadProgress
     */
    readFile: function(path, encoding, callback) {
        var id = lastReadId++;
        var _self = this;
        worker.sender.emit("readFile", { path: path, encoding: encoding, id: id });
        worker.sender.on("readFileResult", function onExecFileResult(event) {
            if (event.data.id !== id)
                return;
            worker.sender.off("readFileResult", onExecFileResult);
            callback(event.data.err, event.data.stdout, event.data.stderr);
        });
    }
};

});
