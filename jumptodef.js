/**
 * jumptodef Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {
    main.consumes = [
        "plugin", "tabs", "ace", "language",
        "menus", "commands", "c9", "tabs",
        "tabbehavior"
    ];
    main.provides = ["language.jumptodef"];
    return main;
    
    function main(options, imports, register) {
        var Plugin = imports.plugin;
        var editors = imports.editors;
        var language = imports.language;
        var commands = imports.commands;
        var tabbehavior = imports.tabbehavior;
        var ace = imports.ace;
        var tabs = imports.tabs;
        var util = require("plugins/c9.language.generic/complete_util");
        var menus = imports.menus;
        
        var CRASHED_JOB_TIMEOUT = 30000;
        var removeSpinnerNodes;
        var worker;
        var loaded;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        function load() {
            if (loaded) return false;
            loaded = true;
            
            language.on("worker.init", function(e) {
                worker = e.worker;
        
                commands.addCommand({
                    name: "jumptodef",
                    bindKey: {mac: "F3", win: "F3"},
                    hint: "jump to the definition of the variable or function that is under the cursor",
                    exec: function(){
                        jumptodef();
                    }
                }, plugin);
        
                // right click context item in ace
                var mnuJumpToDef = new apf.item({
                    id: "mnuCtxEditorJumpToDef",
                    caption: "Jump to Definition",
                    command: "jumptodef"
                });
    
                ace.getElement("menu", function(menu) {
                    // menus.addItemByPath("~", new apf.divider(), 751, menu, plugin),
                    menus.addItemByPath("Jump to Definition", mnuJumpToDef, 750, menu, plugin);
                    menu.on("prop.visible", function(e) {
                        // only fire when visibility is set to true
                        if (e.value) {
                            // because of delays we'll enable by default
                            mnuJumpToDef.enable();
                            checkIsJumpToDefAvailable();
                        }
                    });
                });
                menus.addItemByPath("Goto/Jump to Definition", mnuJumpToDef, 899, plugin);
    
                // when the context menu pops up we'll ask the worker whether we've
                // jumptodef available here
        
                // listen to the worker's response
                worker.on("definition", function(e) {
                    onDefinitions(e);
                });
        
                // when the analyzer tells us if the jumptodef result is available
                // we'll disable/enable the jump to definition item in the ctx menu
                worker.on("isJumpToDefinitionAvailableResult", function(ev) {
                    if (ev.data.value) {
                        mnuJumpToDef.enable();
                    }
                    else {
                        mnuJumpToDef.disable();
                    }
                });
            });
        }
        
        function getFirstColumn(row) {
            var editor = editors.currentEditor;
            if (!editor || editor.path != "ext/code/code" || !editor.amlEditor)
                return 0;
            var line = editor.getDocument().getLine(row);
            if (!line)
                return 0;
            return line.match(/^(\s*)/)[1].length;
        }
    
        /**
         * Fire an event to the worker that asks whether the jumptodef is available for the
         * current position.
         * Fires an 'isJumpToDefinitionAvailableResult' event on the same channel when ready
         */
        function checkIsJumpToDefAvailable() {
            var ace = tabs.focussedPage.editor.ace;
            if (!ace)
                return;
    
            worker.emit("isJumpToDefinitionAvailable", { data: ace.getSelection().getCursor() });
        }
    
        function jumptodef() {
            if (!tabs.focussedPage || !tabs.focussedPage.editor || !tabs.focussedPage.editor.ace)
                return;
                
            var ace = tabs.focussedPage.editor.ace;
    
            activateSpinner();
            onJumpStart(ace);
    
            var sel = ace.getSelection();
            var pos = sel.getCursor();
    
            worker.emit("jumpToDefinition", {
                data: pos
            });
        }
    
        function onDefinitions(e) {
            clearSpinners();
    
            var results = e.data.results;
    
            var editor = editors.currentEditor;
            if (!editor || editor.path != "ext/code/code" || !editor.amlEditor)
                return;
    
            if (!results.length)
                return onJumpFailure(e, editor);
    
            // We have no UI for multi jumptodef; we just take the last for now
            var lastResult;
            for (var i = results.length - 1; i >=0; i--) {
                lastResult = results[results.length - 1];
                if (!lastResult.isDeferred)
                    break;
            }
    
            var _self = this;
            var path = lastResult.path ? ide.davPrefix.replace(/[\/]+$/, "") + "/" + lastResult.path : undefined;
    
            editors.gotoDocument({
                getColumn: function() {
                    return lastResult.column !== undefined ? lastResult.column : _self.getFirstColumn(lastResult.row);
                },
                row: lastResult.row + 1,
                node: path ? undefined : ide.getActivePage().xmlRoot,
                animate: true,
                path: path
            });
        }
    
        function onJumpFailure(event, editor) {
            var cursor = editor.getSelection().getCursor();
            var oldPos = event.data.pos;
            if (oldPos.row !== cursor.row || oldPos.column !== cursor.column)
                return;
            var line = editor.getDocument().getLine(oldPos.row);
            if (!line)
                return;
            var preceding = util.retrievePrecedingIdentifier(line, cursor.column);
            var column = cursor.column - preceding.length;
            if (column === oldPos.column)
                column = getFirstColumn(cursor.row);
            var newPos = { row: cursor.row, column: column };
            editor.getSelection().setSelectionRange({ start: newPos, end: newPos });
        }
    
        function onJumpStart(ace) {
            var cursor = ace.getSelection().getCursor();
            var line = ace.getSession().getDocument().getLine(cursor.row);
            if (!line)
                return;
            
            var preceding = util.retrievePrecedingIdentifier(line, cursor.column);
            var column = cursor.column - preceding.length;
            var following = util.retrieveFollowingIdentifier(line, column);
            var startPos = { row: cursor.row, column: column };
            
            var endPos = { row: cursor.row, column: column + following.length };
            
            ace.getSelection().setSelectionRange({ start: startPos, end: endPos });
        }
    
        function activateSpinner() {
            try {
                var node = ide.getActivePage().$doc.getNode();
                apf.xmldb.setAttribute(node, "lookup", "1");
                removeSpinnerNodes.push(node);
                var _self = this;
                setTimeout(function() {
                    _self.clearSpinners();
                }, CRASHED_JOB_TIMEOUT);
            } catch (e) {
                // Whatever, some missing non-critical UI
                console.error(e);
            }
        }
    
        function clearSpinners() {
            try {
                removeSpinnerNodes.forEach(function(node) {
                    apf.xmldb.removeAttribute(node, "lookup");
                });
                removeSpinnerNodes = [];
            } catch (e) {
                // Whatever, some missing non-critical UI
                console.error(e);
            }
        }
        
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
        
        register(null, {
            "language.jumptodef": plugin.freezePublicAPI({})
        });
    }
});
