/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "tabManager", "language", "ui"
    ];
    main.provides = ["language.tooltip"];
    return main;
    
    function main(options, imports, register) {
        var language = imports.language;
        var tabs = imports.tabManager;
        var dom = require("ace/lib/dom");
        var Plugin = imports.Plugin;
        var ui = imports.ui;
        var tree = require("treehugger/tree");
        var lang = require("ace/lib/lang");
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        var editor;
        var isVisible;
        var labelHeight;
        var adjustCompleterTop;
        var isTopdown;
        var lastPos;
        var cursormoveTimeout;
        
        var tooltipEl = dom.createElement("div");
        tooltipEl.className = "language_tooltip dark";
        
        var assert = require("plugins/c9.util/assert");

        language.getWorker(function(err, worker) {
            worker.on("hint", function(event) {
                var tab = tabs.focussedTab;
                if (!tab || tab.path !== event.data.path)
                    return;
                
                assert(tab.editor && tab.editor.ace, "Could find a tab but no editor for " + event.data.path);
                onHint(event, tab.editor.ace);
            });
            language.on("cursormove", function(e) {
                clearTimeout(cursormoveTimeout);
                if (lastPos && !inRange(lastPos, e.data))
                    hide(true);
                cursormoveTimeout = setTimeout(function() {
                    worker.emit("cursormove", e);
                }, 100);
            });
        });
    
        function onHint(event, editor) {
            var message = event.data.message;
            var pos = event.data.pos;
            var cursorPos = editor.getCursorPosition();
            var displayPos = event.data.displayPos || cursorPos;
            lastPos = pos;
            if (message && inRange(pos, cursorPos))
                show(displayPos.row, displayPos.column, message, editor);
            else
                hide();
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
        
        function show(row, column, html, _editor) {
            draw();
            editor = _editor;
            
            
            if (!isVisible) {
                isVisible = true;
                
                editor.renderer.scroller.appendChild(tooltipEl);
                editor.on("mousewheel", hide.bind(null, true));
                document.addEventListener("mouseup", hide.bind(null, true));
            }
            tooltipEl.innerHTML = html;
            //setTimeout(function() {
                var offset = editor.renderer.scroller.getBoundingClientRect();
                var position = editor.renderer.textToScreenCoordinates(row, column);
                var cursorConfig = editor.renderer.$cursorLayer.config;
                var labelWidth = dom.getInnerWidth(tooltipEl);
                labelHeight = dom.getInnerHeight(tooltipEl);
                position.pageX -= offset.left;
                position.pageY -= offset.top;
                isTopdown = true;
                if (position.pageY < labelHeight)
                    isTopdown = true;
                else if (position.pageY + labelHeight > window.innerHeight - offset.top)
                    isTopdown = false;
                tooltipEl.style.left = (position.pageX - 22) + "px";
                if (!isTopdown)
                    tooltipEl.style.top = (position.pageY - labelHeight + 3) + "px";
                else
                    tooltipEl.style.top = (position.pageY + cursorConfig.lineHeight + 2) + "px";
                adjustCompleterTop && adjustCompleterTop(labelHeight);
            //});
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
                window.document.removeEventListener("mouseup", hide);
                editor.off("mousewheel", hide);
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
