/*
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
 
/**
 * This module is used as a base class for language handlers.
 * It provides properties, helper functions, and functions that
 * can be overridden by language handlers to implement
 * language services such as code completion.
 * 
 * See {@link language}
 * 
 * @class language.base_handler
 */
define(function(require, exports, module) {

var lastExecId = 0;
var lastReadId = 0;

module.exports = {
    
    /**
     * Indicates the handler handles editors, the immediate window,
     * and anything else.
     */
    HANDLES_ANY: 0,
    
    /**
     * Indicates the handler only handles editors, not the immediate window.
     */
    HANDLES_EDITOR: 1,
    
    /**
     * Indicates the handler only handles the immediate window, not editors.
     */
    HANDLES_IMMEDIATE: 2,
    
    /**
     * Indicates the handler only handles the immediate window, not editors.
     */
    HANDLES_EDITOR_AND_IMMEDIATE: 3,
    
    /**
     * The language this worker is currently operating on.
     * @type {String}
     */
    language: null,
    
    /**
     * The path of the file this worker is currently operating on.
     * @type {String}
     */
    path: null,
    
    /**
     * The current workspace directory.
     * @type {String}
     */
    workspaceDir: null,
    
    /**
     * The current document this worker is operating on.
     * 
     * @type {ace.Document}
     */
    doc: null,

    // UTILITIES

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
     * @return {RegExp}
     */
    $getIdentifierRegex: function() {
        return null;
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
        // implemented by worker.completeUpdate
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
        var lastReadId = 0;
        var _self = this;
        this.sender.emit("execFile", { path: path, options: options, id: id });
        this.sender.on("execFileResult", function onExecFileResult(event) {
            if (event.data.id !== id)
                return;
            _self.sender.off("execFileResult", onExecFileResult);
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
        var id = lastExecId++;
        var _self = this;
        this.sender.emit("readFile", { path: path, options: options, id: id });
        this.sender.on("execFileResult", function onExecFileResult(event) {
            if (event.data.id !== id)
                return;
            _self.sender.off("execFileResult", onExecFileResult);
            callback(event.data.err, event.data.stdout, event.data.stderr);
        });
    },

    // OVERRIDABLE ACCESORS

    /**
     * Returns whether this language handler should be enabled for the given
     * file.
     * 
     * Must be overridden by inheritors.
     * 
     * @param {String} language   to check the handler against
     * @return {Boolean}
     */
    handlesLanguage: function(language) {
        throw new Error("base_handler.handlesLanguage() is not overridden");
    },

    /**
     * Returns whether this language handler should be used in a
     * particular kind of editor.
     * 
     * May be overridden by inheritors; returns {@link #HANDLES_EDITOR}
     * by default.
     * 
     * @return {Number} One of {@link #HANDLES_EDITOR},
     *                  {@link #HANDLES_IMMEDIATE}, or
     *                  {@link #HANDLES_EDITOR_AND_IMMEDIATE}, or
     *                  {@link #HANDLES_ANY}.
     */
    handlesEditor: function() {
        return this.HANDLES_EDITOR;
    },
    
    /**
     * Returns the maximum file size this language handler supports.
     * Should return Infinity if size does not matter.
     * Default is 10.000 lines of 80 characters.
     * 
     * May be overridden by inheritors.
     * 
     * @return {Number}
     */
    getMaxFileSizeSupported: function() {
        // Conservative default
        return 10000 * 80;
    },

    /**
     * Determine if the language component supports parsing.
     * Assumed to be true if at least one hander for the language reports true.
     * 
     * Should be overridden by inheritors.
     * 
     * @return {Boolean}
     */
    isParsingSupported: function() {
        return false;
    },

    /**
     * Returns a regular expression for identifiers in the handler's language.
     * If not specified, /[A-Za-z0-9\$\_]/ is used.
     * 
     * Should be overridden by inheritors that implement code completion.
     * 
     * @return RegExp
     */
    getIdentifierRegex: function() {
        return null;
    },
    
    /**
     * Returns a regular expression used to trigger code completion.
     * If a non-null value is returned, it is assumed continous completion
     * is supported for this language.
     * 
     * As an example, Java-like languages might want to use: /\./
     * 
     * Should be overridden by inheritors that implement code completion.
     * Default implementation returns null.
     * 
     * @return RegExp
     */
    getCompletionRegex: function() {
        return null;
    },

    // PARSING AND ABSTRACT SYNTAX CALLBACKS

    /**
     * Parses the given document.
     * 
     * Should be overridden by inheritors that implement parsing
     * (which is, like all features here, optional).
     * 
     * @param value {String}   the source the document to analyze
     * @return {Object}        an abstract syntax tree (of any type), or null if not implemented
     */
    parse: function(value, callback) {
        callback();
    },

    /**
     * Finds a tree node at a certain row and column,
     * e.g. using the findNode(pos) function of treehugger.
     * 
     * Should be overridden by inheritors that implement parsing.
     * 
     * @param {Object} ast                An abstract syntax tree object from {@link #parse}
     * @param {Object} pos                The position of the node to look up
     * @param {Number} pos.row            The position's row
     * @param {Number} pow.column         The position's column
     * @param {Function} callback         The callback for the result
     * @param {Object} [callback.result]  The found node
     */
    findNode: function(ast, pos, callback) {
        callback();
    },

    /**
     * Returns the  a tree node at a certain row and col,
     * e.g. using the node.getPos() function of treehugger.
     * 
     * Should be overridden by inheritors that implement parsing.
     * 
     * @param {Object} node                The node to look up
     * @param {Function} callback          The callback for the result
     * @param {Object} [callback.result]   The resulting position
     * @param {Number} callback.result.sl  The starting line
     * @param {Number} callback.result.el  The ending line
     * @param {Number} callback.result.sc  The starting column
     * @param {Number} callback.result.ec  The ending column
     */
    getPos: function(node, callback) {
        callback();
    },

    // OTHER CALLBACKS

    /**
     * Initialize this language handler.
     * 
     * May be overridden by inheritors.
     * 
     * @param callback            The callback; must be called
     */
    init: function(callback) {
        callback();
    },

    /**
     * Invoked when the document has been updated (possibly after a certain delay)
     * 
     * May be overridden by inheritors.
     * 
     * @param {ace.Document} doc  The current document
     * @param {Function} callback            The callback; must be called
     */
    onUpdate: function(doc, callback) {
        callback();
    },

    /**
     * Invoked when a new document has been opened.
     * 
     * May be overridden by inheritors.
     * 
     * @param {String} path        The path of the newly opened document
     * @param {String} doc         The Document object representing the source
     * @param {String} oldPath     The path of the document that was active before
     * @param {Function} callback  The callback; must be called
     */
    onDocumentOpen: function(path, doc, oldPath, callback) {
        callback();
    },

    /**
     * Invoked when a document is closed in the IDE.
     * 
     * May be overridden by inheritors.
     * 
     * @param {String} path the path of the file
     * @param {Function} callback  The callback; must be called
     */
    onDocumentClose: function(path, callback) {
        callback();
    },

    /**
     * Invoked when the cursor has been moved.
     * 
     * Should be overridden by inheritors that implement tooltips.
     * 
     * @param {ace.Document} doc                  Document object representing the source
     * @param {Object} fullAst                    The entire AST of the current file (if any)
     * @param {Object} cursorPos                  The current cursor position
     * @param {Number} cursorPos.row              The current cursor's row
     * @param {Number} cursorPos.column           The current cursor's column
     * @param {Object} currentNode                The AST node the cursor is currently at (if any)
     * @param {Function} callback                 The callback; must be called
     */
    onCursorMovedNode: function(doc, fullAst, cursorPos, currentNode, callback) {
        callback();
    },
    
    /**
     * Invoked when the cursor has been moved inside to a different AST node.
     * Gets a tooltip to display when the cursor is moved to a particular location.
     * 
     * Should be overridden by inheritors that implement tooltips.
     * 
     * @param {ace.Document} doc                           Document object representing the source
     * @param {Object} fullAst                             The entire AST of the current file (if any)
     * @param {Object} cursorPos                           The current cursor position
     * @param {Number} cursorPos.row                       The current cursor's row
     * @param {Number} cursorPos.column                    The current cursor's column
     * @param {Object} currentNode                         The AST node the cursor is currently at (if any)
     * @param {Function} callback                          The callback; must be called
     * @param {Object} callback.result                     The function's result
     * @param {String} callback.result.hint                An HTML string with the tooltip to display
     * @param {Object} callback.result.pos                 The position range for which this tooltip is valid
     * @param {Number} callback.result.pos.sl              The starting line
     * @param {Number} callback.result.pos.el              The ending line
     * @param {Number} callback.result.pos.sc              The starting column
     * @param {Number} callback.result.pos.ec              The ending column
     * @param {Object} [callback.result.displayPos]        The position to display this tooltip
     * @param {Number} [callback.result.displayPos.row]    The display position's row
     * @param {Number} [callback.result.displayPos.column] The display position's column* @param {Object} callback.result.markers.pos     The marker's position
     */
    tooltip: function(doc, fullAst, cursorPos, currentNode, callback) {
        callback();
    },
    
    /**
     * Gets the instances to highlight when the cursor is moved to a particular location.
     * 
     * Should be overridden by inheritors that implement occurrence highlighting.
     * 
     * @param {ace.Document} doc                       Document object representing the source
     * @param {Object} fullAst                         The entire AST of the current file (if any)
     * @param {Object} cursorPos                       The current cursor position
     * @param {Number} cursorPos.row                   The current cursor's row
     * @param {Number} cursorPos.column                The current cursor's column
     * @param {Object} currentNode                     The AST node the cursor is currently at (if any)
     * @param {Function} callback                      The callback; must be called
     * @param {Object} callback.result                 The function's result
     * @param {Object[]} [callback.result.markers]     The markers to highlight
     * @param {Object} callback.result.markers.pos     The marker's position
     * @param {Number} callback.result.markers.pos.sl  The starting line
     * @param {Number} callback.result.markers.pos.el  The ending line
     * @param {Number} callback.result.markers.pos.sc  The starting column
     * @param {Number} callback.result.markers.pos.ec  The ending column
     * @param {"occurrence_other"|"occurrence_main"} callback.result.markers.type
     *                                                 The type of occurrence: the main one, or any other one.
     */
    highlightOccurrences: function(doc, fullAst, cursorPos, currentNode, callback) {
        callback();
    },
    
    /**
     * Determines what refactorings to enable when the cursor is moved to a particular location.
     * 
     * Should be overridden by inheritors that implement refactorings.
     * 
     * @param {ace.Document} doc             Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @param {Object} cursorPos             The current cursor position
     * @param {Number} cursorPos.row         The current cursor's row
     * @param {Number} cursorPos.column      The current cursor's column
     * @param {Object} currentNode           The AST node the cursor is currently at (if any)
     * @param {Function} callback            The callback; must be called
     * @param {Object} callback.result       The function's result
     * @param {String[]} [callback.result.enableRefactorings]
     *                                       The refactorings to enable, such as "renameVariable"
     */
    onRefactoringTest: function(doc, fullAst, cursorPos, currentNode, callback) {
        callback();
    },

    /**
     * Constructs an outline.
     * 
     * Example outline object:
     * 
     *     {
     *          icon: 'method',
     *          name: "fooMethod",
     *          pos: this.getPos(),
     *          displayPos: { sl: 15, sc: 20 },
     *          items: [ ...items nested under this method... ]
     *     }
     * 
     * Should be overridden by inheritors that implement an outline.
     * 
     * @param {ace.Document} doc                       The Document object representing the source
     * @param {Object} fullAst                         The entire AST of the current file (if any)
     * @param {Function} callback                      The callback; must be called
     * @param {Object} callback.result                 The function's result, a JSON outline structure or null if not supported
     * @param {"event"|"method"|"method2"|"package"|"property"|"property2"|"unknown","unknown2"}
     *        callback.result.icon                     The icon to display for the first outline item
     * @param {String} callback.result.name            The name to display for the first outline item
     * @param {Object} callback.result.pos             The item's position
     * @param {Number} callback.result.pos.sl          The item's starting row
     * @param {Number} [callback.result.pos.el]        The item's ending row
     * @param {Number} callback.result.pos.sc          The item's starting column
     * @param {Number} [callback.result.pos.ec]        The item's ending column
     * @param {Object} callback.result.displayPos      The item's display position
     * @param {Number} callback.result.displayPos.sl   The item's starting row
     * @param {Number} [callback.result.displayPos.el] The item's ending row
     * @param {Number} callback.result.displayPos.sc   The item's starting column
     * @param {Number} [callback.result.displayPos.ec] The item's ending column
     * @param {Object[]} callback.result.items         Any items nested under the curent item.
     * @param {Boolean [callback.result.isGeneric]     Indicates that this is a generic, language-independent outline
     */
    outline: function(doc, fullAst, callback) {
        callback();
    },

    /**
     * Constructs a hierarchy.
     * 
     * Should be overridden by inheritors that implement a type hierarchy.
     * Not supported right now.
     * 
     * @param {ace.Document} doc         The Document object representing the source
     * @param {Object} cursorPos         The current cursor position
     * @param {Number} cursorPos.row     The current cursor's row
     * @param {Number} cursorPos.column  The current cursor's column
     * @param {Function} callback        The callback; must be called
     * @param {Object} callback.result   A JSON hierarchy structure or null if not supported
     */
    hierarchy: function(doc, cursorPos, callback) {
        callback();
    },

    /**
     * Performs code completion for the user based on the current cursor position.
     * 
     * Should be overridden by inheritors that implement code completion.
     * 
     * Example completion result:
     * {
     *    name        : "foo()",
     *    replaceText : "foo()",
     *    icon        : "method",
     *    meta        : "FooClass",
     *    doc         : "The foo() method",
     *    docHead     : "FooClass.foo",
     *    priority    : 1
     *  };
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @param {Object} pos                   The current cursor position
     * @param {Number} pos.row               The current cursor's row
     * @param {Number} pos.column            The current cursor's column
     * @param {Object} currentNode           The AST node the cursor is currently at (if any)
     * @param {Function} callback            The callback; must be called
     * @param {Object} callback.result       The function's result, an array of completion matches
     * @param {String} callback.result.name  The name to show in the popup
     * @param {String} callback.result.replaceText
     *                                       The text to replace the selection with
     * @param {"event"|"method"|"method2"|"package"|"property"|"property2"}
     *                [callback.result.icon] The icon to use
     * @param {String} callback.result.meta  Additional information to show
     * @param {String} callback.result.doc   Documentation to display
     * @param {String} callback.result.docHead
     *                                       Documentation heading to display
     * @param {Number} callback.result.priority
     *                                       Priority of this completion suggestion
     * @param {Boolean} callback.result.isGeneric
     *                                       Indicates that this is a generic, language-independent
     *                                       suggestion
     * @param {Boolean} callback.result.isContextual
     *                                       Indicates that this is a contextual completion,
     *                                       and that any generic completions should not be shown
     */
    complete: function(doc, fullAst, pos, currentNode, callback) {
        callback();
    },

    /**
     * Enables the handler to do analysis of the AST and annotate as desired.
     * 
     * Example of an annotation to return:
     * 
     *     {
     *         pos: { sl: 1, el: 1, sc: 4, ec: 5 },
     *         level: "warning",
     *         type: "warning",
     *         message: "Assigning to undeclared variable."
     *     }
     * 
     * Should be overridden by inheritors that implement analysis.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @param {Function} callback            The callback; must be called
     * @param {Object} callback.result       The function's result, an array of error and warning markers
     */
    analyze: function(value, fullAst, callback) {
        callback();
    },

    /**
     * Invoked when inline variable renaming is activated.
     * 
     * Example result, renaming a 3-character identfier
     * on line 10 that also occurs on line 11 and 12:
     * 
     *     {
     *         length: 3,
     *         pos: {
     *             row: 10,
     *             column: 5
     *         },
     *         others: [
     *             { row: 11, column: 5 },
     *             { row: 12, column: 5 }
     *         ]
     *     }
     * 
     * Should be overridden by inheritors that implement rename refactoring.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @param {Object} pos                   The current cursor position
     * @param {Number} pos.row               The current cursor's row
     * @param {Number} pos.column            The current cursor's column
     * @param {Object} currentNode           The AST node the cursor is currently at (if any)
     * @param {Function} callback            The callback; must be called
     * @param {Object} callback.result       The function's result.
     */
    getVariablePositions: function(doc, fullAst, pos, currentNode, callback) {
        callback();
    },

    /**
     * Invoked when refactoring is started -> So, for java, saving the file is no more legal to do
     * 
     * Should be overridden by inheritors that implement rename refactoring.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Function} callback            The callback; must be called
     */
    onRenameBegin: function(doc, callback) {
        callback();
    },

    /**
     * Invoked when a refactor request is being finalized and waiting for a status
     * 
     * May be overridden by inheritors that implement rename refactoring.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param oldName                        The old identifier was being renamed
     * @param newName                        The new name of the element after refactoring
     * @param {Function} callback            The callback; must be called
     * @param {String} [callback.err]        Indicates whether to progress or an error message if refactoring failed
     */
    commitRename: function(doc, oldName, newName, callback) {
        callback();
    },

    /**
     * Invoked when a refactor request is cancelled
     * 
     * May be overridden by inheritors that implement rename refactoring.
     * 
     * @param {Function} callback            The callback; must be called
     */
    onRenameCancel: function(callback) {
        callback();
    },

    /**
     * Invoked when an automatic code formating is wanted
     * 
     * Should be overridden by inheritors that implement code formatting.
     * 
     * @param {ace.Document} doc the Document object representing the source
     * @param {Function} callback            The callback; must be called
     * @param {Object} callback.result       The function's result
     * @return a string value representing the new source code after formatting or null if not supported
     */
    codeFormat: function(doc, callback) {
        callback();
    },

    /**
     * Performs jumping to a definition.
     * 
     * Should be overridden by inheritors that implement jump to definition.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @param {Object} pos                   The current cursor position
     * @param {Number} pos.row               The current cursor's row
     * @param {Number} pos.column            The current cursor's column
     * @param {Function} callback            The callback; must be called
     * @param {Object[]} callback.results    The results
     * @param {String} [callback.results.path]
     *                                       The result path
     * @param {Number} [callback.results.row]
     *                                       The result row
     * @param {Number} [callback.results.column]
     *                                       The result column
     * @param {Boolean} [callback.results.isGeneric]
     *                                       Indicates that this is a generic, language-independent
     *                                       suggestion
     */
    jumpToDefinition: function(doc, fullAst, pos, currentNode, callback) {
        callback();
    },
    
    /**
     * Gets marker resolutions for quick fixes.
     * 
     * Must be overridden by inheritors that implement quick fixes.
     * 
     * @see #hasResolutions
     * 
     * @param {ace.Document} doc                    The Document object representing the source
     * @param {Object} fullAst                      The entire AST of the current file (if any)
     * @param {Object} markers                      The markers to get resolutions for
     * @param {Function} callback                   The callback; must be called
     * @param {Object} callback.result              The function's result
     * @return {language.MarkerResolution[]} Resulting resolutions.
     */
    getResolutions: function(doc, fullAst, markers, callback) {
        callback();
    },
    
    /**
     * Determines if there are marker resolutions for quick fixes.
     * 
     * Must be overridden by inheritors that implement quick fixes.
     * 
     * @param {ace.Document} doc             The Document object representing the source
     * @param {Object} fullAst               The entire AST of the current file (if any)
     * @return true iff the resolver for this marker could generate
     * @param {Function} callback            The callback; must be called
     * @param {Boolean} callback.result      There is at least one resolution
     */
    hasResolution: function(doc, fullAst, marker, callback) {
        callback();
    },
    
    /** 
     * Given the cursor position and the parsed node at that position,
     * gets the string to send to the debugger for live inspect hovering.
     * 
     * Should be overridden by inheritors that implement a debugger
     * with live inspect. If not implemented, the string value based on
     * currentNode's position is used.
     * 
     * @param {ace.Document} doc                The Document object representing the source
     * @param {Object} fullAst                  The entire AST of the current file (if any)
     * @param {Object} pos                      The current cursor position
     * @param {Number} pos.row                  The current cursor's row
     * @param {Number} pos.column               The current cursor's column
     * @param {Function} callback               The callback; must be called
     * @param {Object} callback.result          The resulting expression
     * @param {String} callback.result.value    The string representation of the expression to inspect
     * @param {Object} callback.result.pos      The expression's position
     * @param {Number} callback.result.pos.sl   The expression's starting row
     * @param {Number} callback.result.pos.el   The expression's ending row
     * @param {Number} callback.result.pos.sc   The expression's starting column
     * @param {Number} callback.result.pos.ec   The expression's ending column
     */
    getInspectExpression: function(doc, fullAst, pos, currentNode, callback) {
        callback();
    }
};

});
