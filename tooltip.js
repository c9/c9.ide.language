/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "tabManager", "language", "ui", "ace"
    ];
    main.provides = ["language.tooltip"];
    return main;
    
    function main(options, imports, register) {
        var language  = imports.language;
        var tabs      = imports.tabManager;
        var dom       = require("ace/lib/dom");
        var Plugin    = imports.Plugin;
        var ui        = imports.ui;
        var aceHandle = imports.ace;
        var tree      = require("treehugger/tree");
        var lang      = require("ace/lib/lang");
        var assert    = require("plugins/c9.util/assert");
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        var ace, languageWorker, isVisible, labelHeight, adjustCompleterTop;
        var isTopdown, tooltipEl, allowImmediateEmit, lastPos;
        var cursormoveTimeout, onMouseDownTimeout;
        
        function load(){
            tooltipEl = dom.createElement("div");
            tooltipEl.className = "language_tooltip dark";
            
            language.getWorker(function(err, worker) {
                languageWorker = worker;
                worker.on("hint", function(event) {
                    var tab = tabs.focussedTab;
                    if (!tab || tab.path !== event.data.path)
                        return;
                    
                    assert(tab.editor && tab.editor.ace, "Could find a tab but no editor for " + event.data.path);
                    onHint(event, tab.editor.ace);
                });
                language.on("cursormove", function(e) {
                    clearTimeout(cursormoveTimeout);
                    if (lastPos && !inRange(lastPos, e.pos)) {
                        // Just walked outside of tooltip range
                        if (lastPos.sl !== e.pos.row)
                            hide();
                        if (allowImmediateEmit) {
                            allowImmediateEmit = false;
                            return worker.emit("cursormove", { data: { pos: e.pos, line: e.doc.getLine(e.pos.row) }});
                        }
                    }
                    cursormoveTimeout = setTimeout(function() {
                        var latestPos = e.doc.selection.getCursor();
                        worker.emit("cursormove", { data: { pos: latestPos, line: e.doc.getLine(latestPos.row) }});
                        cursormoveTimeout = null;
                    }, 100);
                });
            });
            
            aceHandle.on("themeChange", function(e){
                var theme = e.theme;
                if (!theme) return;
                
                tooltipEl.className = "language_tooltip " 
                    + (theme.isDark ? "dark" : "");
            }, plugin);
        }
        
        // @todo @lennartcl. This plugin is very messy. I added the things below
        // but I see that the plugin is never returned. Nor is its interface
        // set. Could you fix?
        plugin.on("load", function(){
            load();
        });
        plugin.load("This is not how it is supposed to be");
        
        plugin.on("unload", function(){
            if (tooltipEl)
                tooltipEl.parentNode.removeChild(tooltipEl);
        });
    
        function onHint(event, ace) {
            var message = event.data.message;
            var pos = event.data.pos;
            var cursorPos = ace.getCursorPosition();
            var line = ace.getSession().getDocument().getLine(cursorPos.row);
            
            clearTimeout(onMouseDownTimeout);
            
            if (ace.inMultiSelectMode)
                return hide();
            
            if (line !== event.data.line) {
                // console.warn("Got outdated tooltip event from worker, retrying");
                if (!cursormoveTimeout)
                    cursormoveTimeout = setTimeout(function() {
                        languageWorker.emit("cursormove", { data: { pos: ace.getCursorPosition(), line: line }});
                        cursormoveTimeout = null;
                    }, 50);
                if (lastPos && lastPos.sl !== cursorPos.row)
                    hide();
                return;
            }
            
            if (message && inRange(pos, cursorPos)) {
                var displayPos = event.data.displayPos || cursorPos;
                show(displayPos.row, displayPos.column, message, ace);
                lastPos = pos;
                allowImmediateEmit = true;
            }
            else if (!(lastPos && inRange(lastPos, cursorPos))) {
                hide();
            }
        }
        
        function inRange(pos, cursorPos) {
            // We only consider the cursor in range if it's on the first row
            // of the tooltip area
            return pos.sl === cursorPos.row && tree.inRange(pos, { line: cursorPos.row, col: cursorPos.column });
        } 
        
        var drawn = false;
        function draw() {
            if (drawn) return true;
            drawn = true;
            
            ui.insertCss(require("text!./complete.css"), plugin);
        }
        
        function show(row, column, html, _ace) {
            draw();
            ace = _ace;
            
            if (!isVisible) {
                isVisible = true;
                
                window.document.body.appendChild(tooltipEl);
                ace.on("mousewheel", hide);
                window.document.addEventListener("mousedown", onMouseDown);
            }
            tooltipEl.innerHTML = html;
            //setTimeout(function() {
                var position = ace.renderer.textToScreenCoordinates(row, column);
                var cursorConfig = ace.renderer.$cursorLayer.config;
                var labelWidth = dom.getInnerWidth(tooltipEl);
                labelHeight = dom.getInnerHeight(tooltipEl);
                isTopdown = true;
                if (position.pageY < labelHeight)
                    isTopdown = true;
                else if (position.pageY + labelHeight > window.innerHeight)
                    isTopdown = false;
                tooltipEl.style.left = (position.pageX - 22) + "px";
                if (!isTopdown)
                    tooltipEl.style.top = (position.pageY - labelHeight + 3) + "px";
                else
                    tooltipEl.style.top = (position.pageY + cursorConfig.lineHeight + 2) + "px";
                adjustCompleterTop && adjustCompleterTop(labelHeight);
            //});
        }
        
        function onMouseDown() {
            clearTimeout(onMouseDownTimeout);
            onMouseDownTimeout = setTimeout(hide, 300);
        }
        
        function getHeight() {
            return isVisible && labelHeight || 0;
        }
        
        function isTopdown() {
            return isTopdown;
        }
        
        function getRight() {
            return isVisible && tooltipEl.getBoundingClientRect().right;
        }
            
        function hide(clearLastPos) {
            if (clearLastPos)
                lastPos = null;
            if (isVisible) {
                try {
                    tooltipEl.parentElement.removeChild(tooltipEl);
                } catch(e) {
                    console.error(e);
                }
                window.document.removeEventListener("mousedown", onMouseDown);
                ace.off("mousewheel", hide);
                isVisible = false;
            }
        }
        
        /**
         * @internal
         */
        register(null, {
            "language.tooltip": {
                hide: hide,
                show: show,
                getHeight: getHeight,
                getRight: getRight,
                isTopdown: isTopdown,
                set adjustCompleterTop(f) {
                    adjustCompleterTop = f;
                }
            }
        });
    }
    
});
