/**
 * jumptodef Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "tabManager", "ace", "language",
        "menus", "commands", "c9", "tabManager",
        "ui"
    ];
    main.provides = ["language.jumptodef"];
    return main;
    
    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var language = imports.language;
        var commands = imports.commands;
        var aceHandle = imports.ace;
        var tabs = imports.tabManager;
        var ui = imports.ui;
        var util = require("plugins/c9.ide.language/complete_util");
        var menus = imports.menus;
        
        var CRASHED_JOB_TIMEOUT = 30000;
        var worker;
        var loaded;
        var lastJump;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        function load() {
            if (loaded) return false;
            loaded = true;
            
            language.on("initWorker", function(e) {
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
                var mnuJumpToDef = new ui.item({
                    id: "mnuEditorJumpToDef",
                    caption: "Jump to Definition",
                    command: "jumptodef"
                });
                var mnuJumpToDef2 = new ui.item({
                    caption: "Jump to Definition",
                    command: "jumptodef",
                    id: "mnuEditorJumpToDef2"
                });
    
                aceHandle.getElement("menu", function(menu) {
                    menus.addItemToMenu(menu, mnuJumpToDef2, 750, plugin);
                    menu.on("prop.visible", function(e) {
                        // only fire when visibility is set to true
                        if (e.value) {
                            // because of delays we'll enable by default
                            mnuJumpToDef2.enable();
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
                        mnuJumpToDef2.enable();
                    }
                    else {
                        mnuJumpToDef2.disable();
                    }
                });
            });
        }
        
        function getFirstColumn(ace, row, identifier) {
            var document = ace.document || ace.getSession().getDocument();
            if (!document)
                return 0;
            var line = document.getLine(row);
            if (!line)
                return 0;
            var safeIdentifier = identifier.replace(/[^A-Za-z0-9\/$_/']/g, "");
            return line.match("^(\s*(.*(?=" + safeIdentifier + "))?)")[1].length;
        }
    
        /**
         * Fire an event to the worker that asks whether the jumptodef is available for the
         * current position.
         * Fires an 'isJumpToDefinitionAvailableResult' event on the same channel when ready
         */
        function checkIsJumpToDefAvailable() {
            var ace = tabs.focussedTab.editor.ace;
            if (!ace)
                return;
    
            worker.emit("isJumpToDefinitionAvailable", { data: ace.getSelection().getCursor() });
        }
    
        function jumptodef() {
            if (!tabs.focussedTab || !tabs.focussedTab.editor || !tabs.focussedTab.editor.ace)
                return;
            
            var tab = tabs.focussedTab;
            var ace = tab.editor.ace;
            var sel = ace.getSelection();
            var pos = sel.getCursor();
    
            activateSpinner(tabs.focussedTab);
            onJumpStart(ace);
            
            if (lastJump && lastJump.ace === ace
                && lastJump.row === pos.row && lastJump.column === pos.column) {
                clearSpinners(tab);
                jumpToPos(lastJump.sourcePath, lastJump.sourcePos);
                return;
            }
                
            
            lastJump = null;
    
            worker.emit("jumpToDefinition", {
                data: pos
            });
        }
    
        function onDefinitions(e) {
            var tab = tabs.findTab(e.data.path);
            if (!tab) return;
            
            clearSpinners(tab);
    
            var results = e.data.results;
    
            var editor = tab.editor;
    
            if (!results.length)
                return onJumpFailure(e, editor.ace);
    
            // We have no UI for multi jumptodef; we just take the last for now
            var lastResult;
            for (var i = results.length - 1; i >=0; i--) {
                lastResult = results[results.length - 1];
                if (!lastResult.isGeneric)
                    break;
            }
    
            var path = lastResult && lastResult.path || tab.path;
            
            jumpToPos(path, lastResult, e.data.path, e.data.pos, e.data.identifier);
        }
        
        function jumpToPos(path, pos, sourcePath, sourcePos, identifier) {
            tabs.open(
                {
                    path: path,
                    active: true
                },
                function(err, tab) {
                    if (err)
                        return;
                    var state = tab.document && tab.document.getState();
                    if (state && state.ace) {
                        pos.column = pos.column || getFirstColumn(tab.editor.ace, pos.row, identifier);
                        lastJump = sourcePos && {
                            ace: tab.editor.ace,
                            row: pos.row,
                            column: pos.column,
                            path: path,
                            sourcePos: sourcePos,
                            sourcePath: sourcePath
                        };
                        state.ace.jump = {
                            row: pos.row,
                            column: pos.column
                        };
                    }
                    delete state.value;
                    tab.document.setState(state);
                }
            );
        }
    
        function onJumpFailure(event, ace) {
            var cursor = ace.getSelection().getCursor();
            var oldPos = event.data.pos;
            if (oldPos.row !== cursor.row || oldPos.column !== cursor.column)
                return;
            var line = ace.getSession().getLine(oldPos.row);
            if (!line)
                return;
            var preceding = util.retrievePrecedingIdentifier(line, cursor.column);
            var column = cursor.column - preceding.length;
            if (column === oldPos.column)
                column = getFirstColumn(ace, cursor.row);
            var newPos = { row: cursor.row, column: column };
            ace.getSelection().setSelectionRange({ start: newPos, end: newPos });
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
    
        function activateSpinner(tab) {
            tab.className.add("loading");
            clearTimeout(tab.$jumpToDefReset);
            tab.$jumpToDefReset = setTimeout(function() {
                clearSpinners(tab);
            }, CRASHED_JOB_TIMEOUT);
        }
    
        function clearSpinners(tab) {
            clearTimeout(tab.$jumpToDefReset);
            tab.className.remove("loading");
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
            "language.jumptodef": plugin.freezePublicAPI({
                /** @ignore */
                getFirstColumn : getFirstColumn
            })
        });
    }
});
