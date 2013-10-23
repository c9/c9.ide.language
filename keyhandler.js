/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "tabManager", "ace", "language",
        "language.complete", "language.tooltip"
    ];
    main.provides = ["language.keyhandler"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var aceHandle = imports.ace;
        var language = imports.language;
        var marker = imports["language.marker"];
        var complete = imports["language.complete"];
        var tooltip = imports["language.tooltip"];
        var complete_util = require("./complete_util");
        var TokenIterator = require("ace/token_iterator").TokenIterator;
        var DEFAULT_ID_REGEX = complete_util.DEFAULT_ID_REGEX;
        var ace;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        //var emit   = plugin.getEmitter();
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            aceHandle.on("create", function(e){
                var editor = e.editor;
                
                editor.on("draw", function(){
                    var kb = editor.ace.keyBinding;
                    var defaultHandler          = kb.onTextInput.bind(kb);
                    var defaultCommandHandler   = kb.onCommandKey.bind(kb);
                    kb.onTextInput  = composeHandlers(onTextInput, defaultHandler, editor.ace);
                    kb.onCommandKey = composeHandlers(onCommandKey, defaultCommandHandler, editor.ace);
                });
            });
        }
        
        /***** Methods *****/
        
        function composeHandlers(mainHandler, fallbackHandler, myAce) {
            return function onKeyPress() {
                ace = myAce;
                
                var result = mainHandler.apply(null, arguments);
                if (!result)
                    fallbackHandler.apply(null, arguments);
            };
        }
        
        function onTextInput(text, pasted) {
            if (language.disabled)
                return false;
            if (language.isContinuousCompletionEnabled())
                typeAlongCompleteTextInput(text, pasted);
            else
                inputTriggerComplete(text, pasted);
            return false;
        }
        
        function onCommandKey(e) {
            if (language.disabled)
                return false;
            if (language.isContinuousCompletionEnabled())
                typeAlongComplete(e);
        
            if (e.keyCode == 27) // Esc
                tooltip.hide();
                
            return false;
        }
        
        function typeAlongComplete(e){
            if (e.metaKey || e.altKey || e.ctrlKey)
                return false;
            if (e.keyCode === 8) { // Backspace
                var pos = ace.getCursorPosition();
                var line = ace.getSession().getDocument().getLine(pos.row);
                if (!complete_util.precededByIdentifier(line, pos.column, null, ace))
                    return false;
                if (complete.getContinousCompletionRegex(null, ace))
                    complete.deferredInvoke(false, ace);
            }
        }
        
        function inputTriggerComplete(text, pasted) {
            var completionRegex = complete.getContinousCompletionRegex(null, ace);
            var idRegex = complete.getIdentifierRegex(null, ace);
            if (!pasted && completionRegex && text.match(completionRegex))
                handleChar(text, idRegex, completionRegex); 
        }
        
        function typeAlongCompleteTextInput(text, pasted) {
            var completionRegex = complete.getContinousCompletionRegex(null, ace);
            var idRegex = complete.getIdentifierRegex(null, ace);
            if (pasted)
                return false;
            handleChar(text, idRegex, completionRegex); 
        }
        
        function isJavaScript() {
            return ace.getSession().syntax === "javascript";
        }
        
        function inTextToken(pos) {
            var token = new TokenIterator(ace.getSession(), pos.row, pos.column).getCurrentToken();
            return token && token.type && token.type === "text";
        }
        
        function inCommentToken(pos) {
            var token = new TokenIterator(ace.getSession(), pos.row, pos.column).getCurrentToken();
            return token && token.type && token.type.match(/^comment/);
        } 
        
        function handleChar(ch, idRegex, completionRegex) {
            if (ch.match(idRegex || DEFAULT_ID_REGEX) || (completionRegex && ch.match(completionRegex))) { 
                var pos = ace.getCursorPosition();
                var line = ace.getSession().getDocument().getLine(pos.row);
                if (!complete_util.precededByIdentifier(line, pos.column, ch, ace) && !inTextToken(ace, pos))
                    return false;
                complete.deferredInvoke(ch === ".", ace);
            }
            else if (ch === '"' || ch === "'") {
                var pos = ace.getCursorPosition();
                var line = ace.getSession().getDocument().getLine(pos.row);
                if (complete_util.isRequireJSCall(line, pos.column, "", ace, true))
                    complete.deferredInvoke(true, ace);
            }
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         */
        plugin.freezePublicAPI({
            /**
             * 
             */
            composeHandlers : composeHandlers
        });
        
        register(null, {
            "language.keyhandler": plugin
        });
    }
});
