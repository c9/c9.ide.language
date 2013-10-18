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
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        var editor;
        var isVisible;
        var labelHeight;
        var completer;
        var adjustCompleterTop;
        var isTopdown;
        
        var tooltipEl = dom.createElement("div");
        tooltipEl.className = "language_tooltip dark";
        
        var assert = require("plugins/c9.util/assert");

        language.on("initWorker", function(e){
            e.worker.on("hint", function(event) {
                var page = tabs.findTab(event.data.path);
                if (!page) return;
                
                var editor = page.editor;
                onHint(event, editor.ace);
            });
        });
    
        function onHint(event, editor) {
            var message = event.data.message;
            var pos = event.data.pos;
            var cursorPos = editor.getCursorPosition();
            var displayPos = event.data.displayPos || cursorPos;
            if (cursorPos.column === pos.column && cursorPos.row === pos.row && message)
                show(displayPos.row, displayPos.column, message, editor);
            else
                hide();
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
                //editor.selection.on("changeCursor", this.hide);
                editor.session.on("changeScrollTop", hide);
                editor.session.on("changeScrollLeft", hide);
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
            
        function hide() {
            if (isVisible) {
                editor.renderer.scroller.removeChild(tooltipEl);
                //editor.selection.removeListener("changeCursor", hide);
                editor.session.removeListener("changeScrollTop", hide);
                editor.session.removeListener("changeScrollLeft", hide);
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
