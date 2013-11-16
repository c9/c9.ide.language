/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "tabManager", "ace", "language",
        "menus", "commands", "c9", "tabManager", "browsersupport",
        "language.tooltip"
    ];
    main.provides = ["language.complete"];
    return main;

    function main(options, imports, register) {
        var Plugin     = imports.Plugin;
        var ui         = imports.ui;
        var c9         = imports.c9;
        var aceHandle  = imports.ace;
        var menus      = imports.menus;
        var tabs       = imports.tabManager;
        var commands   = imports.commands;
        var language   = imports.language;
        var browsers   = imports.browsersupport;
        var tooltip    = imports["language.tooltip"];
        
        var lang           = require("ace/lib/lang");
        var dom            = require("ace/lib/dom");
        var SyntaxDetector = require("./syntax_detector");
        var completeUtil   = require("plugins/c9.ide.language/complete_util");
        var Popup          = require("ace/autocomplete/popup").AcePopup;
        var completedp     = require("./completedp");
        var assert         = require("plugins/c9.util/assert");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var theme;
        
        var isInvokeScheduled = false;
        var ignoreMouseOnce = false;
        var enterCompletion = true;
        var tooltipHeightAdjust = 0;
        
        var oldCommandKey, oldOnTextInput, isDocShown;
        var txtCompleterDoc; // ui elements
        var matches, completionElement;
        var docElement, cursorConfig, lineHeight, lastAce, forceBox, worker; 
        var eventMatches, popup;
        var lastUpDownEvent;
        
        var idRegexes         = {};
        var completionRegexes = {}; 
      
        var DEFAULT_ID_REGEX = completeUtil.DEFAULT_ID_REGEX;
        
        var SHOW_DOC_DELAY = 1500;
        var SHOW_DOC_DELAY_MOUSE_OVER = 100;
        var HIDE_DOC_DELAY = 1000;
        var AUTO_UPDATE_DELAY = 200;
        var CRASHED_COMPLETION_TIMEOUT = 6000;
        var MENU_WIDTH = 330;
        var MENU_SHOWN_ITEMS = 8;
        var EXTRA_LINE_HEIGHT = 4;
        var REPEAT_IGNORE_RATE = 200
        
        var deferredInvoker = lang.deferredCall(function() {
            isInvokeScheduled = false;
            var ace = deferredInvoker.ace;
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getDocument().getLine(pos.row);
            var regex = getIdentifierRegex(null, ace) || DEFAULT_ID_REGEX;
            if (completeUtil.precededByIdentifier(line, pos.column, null, ace) ||
               (line[pos.column - 1] === '.' && (!line[pos.column] || !line[pos.column].match(regex))) ||
               (line[pos.column - 1] && line[pos.column - 1].match(regex)
               ) || // TODO: && keyhandler.inCompletableCodeContext(line, pos.column)) ||
               (language.isInferAvailable() && completeUtil.isRequireJSCall(line, pos.column, "", ace))) {
                invoke(true);
            }
            else {
                closeCompletionBox();
            }
        });
        var drawDocInvoke = lang.deferredCall(function() {
            if (!isPopupVisible()) return;
            var match = matches[popup.getHoveredRow()] || matches[popup.getRow()];
            if (match && (match.doc || match.$doc)) {
                isDocShown = true;
                showDocPopup();
            }
            isDrawDocInvokeScheduled = false;
        });
        var isDrawDocInvokeScheduled = false;
        
        var undrawDocInvoke = lang.deferredCall(function() {
            if (!isPopupVisible()) {
                isDocShown = false;
                hideDocPopup();
            }
        });
        
        var killCrashedCompletionInvoke = lang.deferredCall(function() {
            closeCompletionBox();
        });
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            language.on("initWorker", function(e){
                worker = e.worker;
                
                worker.on("setIdentifierRegex", function(event) {
                    idRegexes[event.data.language] = event.data.identifierRegex;
                });
                worker.on("setCompletionRegex", function(event) {
                    completionRegexes[event.data.language] = event.data.completionRegex;
                }); 
                
                e.worker.on("complete", function(event) {
                    if (language.disabled || plugin.disabled) return;
                    
                    var tab = tabs.focussedTab;
                    if (!tab || !tab.path === event.data.path)
                        return;
                    
                    assert(tab.editor, "Could find a tab but no editor for " + event.data.path);
                    onComplete(event, tab.editor);
                });
            });
            
            menus.addItemByPath("Edit/~", new ui.divider(), 2000, plugin);
            menus.addItemByPath("Edit/Show Autocomplete", new ui.item({
                command : "complete"
            }), 2100, plugin);
            
            commands.addCommand({
                name    : "complete",
                hint    : "code complete",
                bindKey : {
                    mac: "Ctrl-Space|Alt-Space", 
                    win: "Ctrl-Space|Alt-Space"
                },
                isAvailable : function(editor){
                    return editor && language.isEditorSupported({ editor: editor });
                },
                exec : invoke
            }, plugin);
            
            commands.addCommand({
                name    : "completeoverwrite",
                hint    : "code complete & overwrite",
                bindKey : {
                    mac: "Ctrl-Shift-Space|Alt-Shift-Space", 
                    win: "Ctrl-Shift-Space|Alt-Shift-Space"
                },
                isAvailable : function(editor){
                    return editor && language.isEditorSupported({ editor: editor });
                },
                exec : invoke.bind(null, false, true)
            }, plugin);
            
            aceHandle.on("themeChange", function(e){
                theme = e.theme;
                if (!theme || !drawn) return;
                
                txtCompleterDoc.className = "code_complete_doc_text" 
                    + (theme.isDark ? " dark" : "");

                popup.setTheme({
                    cssClass : "code_complete_text",
                    isDark   : theme.isDark,
                    padding  : 0
                });
                popup.renderer.setStyle("dark", theme.isDark);
            }, plugin);
        }
        
        var drawn;
        function draw(){
            if (drawn) return;
            drawn = true;
        
            // Import the CSS for the completion box
            ui.insertCss(require("text!./complete.css"), plugin);
            
            txtCompleterDoc = document.createElement("div");
            txtCompleterDoc.className = "code_complete_doc_text" 
                + (!theme || theme.isDark ? " dark" : "");
            
            popup = new Popup(document.body);
            popup.setTheme({
                cssClass : "code_complete_text",
                isDark   : !theme || theme.isDark,
                padding  : 0
            });
            popup.$imageSize = 8 + 5 + 7 + 1;
            // popup.renderer.scroller.style.padding = "1px 2px 1px 1px";
            popup.renderer.$extraHeight = 4
            popup.renderer.setStyle("dark", !theme || theme.isDark);
            
            completedp.initPopup(popup);
            //@TODO DEPRECATE: onKeyPress
            function clearLastLine(){ popup.onLastLine = false; }
            popup.on("select", clearLastLine);
            popup.on("change", clearLastLine);
            
            // Ace Tree Interaction
            popup.on("mouseover", function() {
                if (ignoreMouseOnce) {
                    ignoreMouseOnce = false;
                    return;
                }
                
                // updateDoc();
                if (!isDrawDocInvokeScheduled)
                    drawDocInvoke.schedule(SHOW_DOC_DELAY_MOUSE_OVER);
            }, false);
            
            popup.on("select", function(){ updateDoc(true) });
            popup.on("changeHoverMarker", function(){ updateDoc(true) });
            
            popup.on("click", function(e) {
                onKeyPress(e, 0, 13);
                e.stop();
            });
            
            emit("draw");
        }
        
        /***** Helper Functions *****/
        
        function isPopupVisible() {
            return popup && popup.isOpen;
        }
        
        function getSyntax(ace) {
            return SyntaxDetector.getContextSyntax(
                ace.getSession().getDocument(),
                ace.getCursorPosition(),
                ace.getSession().syntax);
        }
        
        function isJavaScript(ace) {
            return getSyntax(ace) === "javascript";
        }
        
        function isHtml(ace) {
            return getSyntax(ace) === "html";
        }
        
        /**
         * Replaces the preceeding identifier (`prefix`) with `newText`, where ^^
         * indicate the cursor positions after the replacement.
         * If the prefix is already followed by an identifier substring, that string
         * is deleted.
         */
        function replaceText(ace, match, deleteSuffix) {
            var newText = match.replaceText;
            var pos = ace.getCursorPosition();
            var session = ace.getSession();
            var line = session.getLine(pos.row);
            var doc = session.getDocument();
            var idRegex = match.identifierRegex || getIdentifierRegex(null, ace) || DEFAULT_ID_REGEX;
            var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            var postfix = completeUtil.retrieveFollowingIdentifier(line, pos.column, idRegex) || "";
            
            if (match.replaceText === "require(^^)" && isJavaScript(ace)) {
                newText = "require(\"^^\")";
                if (!isInvokeScheduled)
                    setTimeout(deferredInvoke.bind(null, false, ace), 0);
            }
            
            // Don't insert extra () in front of (
            var endingParens = newText.substr(newText.length - 4) === "(^^)"
                ? 4
                : newText.substr(newText.length - 2) === "()" ? 2 : 0;
            if (endingParens) {
                if (line.substr(pos.column + (deleteSuffix ? postfix.length : 0), 1) === "(")
                    newText = newText.substr(0, newText.length - endingParens);
                if (postfix && line.substr(pos.column, postfix.length + 1) === postfix + "(") {
                    newText = newText.substr(0, newText.length - endingParens);
                    deleteSuffix = true;
                }
            }
        
            newText = newText.replace(/\t/g, session.getTabString());
            
            // Ensure cursor marker
            if (newText.indexOf("^^") === -1)
                newText += "^^";
        
            // Find prefix whitespace of current line
            for (var i = 0; i < line.length && (line[i] === ' ' || line[i] === "\t");)
                i++;
        
            var prefixWhitespace = line.substring(0, i);
            
            // Remove HTML duplicate '<' completions
            var preId = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            if (isHtml(ace) && line[pos.column-preId.length-1] === '<' && newText[0] === '<')
                newText = newText.substring(1);
            
            // Pad the text to be inserted
            var paddedLines = newText.split("\n").join("\n" + prefixWhitespace);
            var splitPaddedLines = paddedLines.split("\n");
            var colOffset = -1, colOffset2 = -1, rowOffset, rowOffset2;
            for (i = 0; i < splitPaddedLines.length; i++) {
                if (colOffset === -1)
                    colOffset = splitPaddedLines[i].indexOf("^^");
                if (colOffset !== -1)
                    colOffset2 = splitPaddedLines[i].lastIndexOf("^^");
                if (colOffset !== -1 && !rowOffset)
                    rowOffset = i;
                if (colOffset2 !== -1 && !rowOffset2)
                    rowOffset2 = i;
            }
            if (rowOffset === rowOffset2 && colOffset !== colOffset2)
                colOffset2 -= 2;
            colOffset2 = colOffset2 || colOffset;
            rowOffset2 = rowOffset2 || rowOffset;
            
            // Remove cursor marker
            paddedLines = paddedLines.replace(/\^\^/g, "");
        
            if (deleteSuffix || paddedLines.slice(-postfix.length) === postfix)
                doc.removeInLine(pos.row, pos.column - prefix.length, pos.column + postfix.length);
            else
                doc.removeInLine(pos.row, pos.column - prefix.length, pos.column);
            doc.insert({row: pos.row, column: pos.column - prefix.length}, paddedLines);
        
            var cursorCol = rowOffset ? colOffset : pos.column + colOffset - prefix.length;
            var cursorCol2 = rowOffset2 ? colOffset2 : pos.column + colOffset2 - prefix.length;
        
            if (line.substring(0, pos.column).match(/require\("[^\"]+$/) && isJavaScript(ace)) {
                if (line.substr(pos.column + postfix.length, 1).match(/['"]/) || paddedLines.substr(0, 1) === '"')
                    cursorCol++;
                if (line.substr(pos.column + postfix.length + 1, 1) === ')')
                    cursorCol++;
            }
            var cursorPos = { row: pos.row + rowOffset, column: cursorCol };
            var cursorPos2 = { row: pos.row + rowOffset2, column: cursorCol2 };
            ace.selection.setSelectionRange({ start: cursorPos, end: cursorPos2 });
        }
        
        function showCompletionBox(editor, m, prefix, line) {
            var ace = editor.ace;
            draw();

            matches = m;
            docElement = txtCompleterDoc;
                       
           
            // Monkey patch
            if (!oldCommandKey) {
                oldCommandKey = ace.keyBinding.onCommandKey;
                ace.keyBinding.onCommandKey = onKeyPress.bind(this);
                oldOnTextInput = ace.keyBinding.onTextInput;
                ace.keyBinding.onTextInput = onTextInput.bind(this);
            }
            
            lastAce = ace;
            
            populateCompletionBox(ace, matches);
            window.document.addEventListener("mousedown", closeCompletionBox);
            ace.on("mousewheel", closeCompletionBox);

            var renderer = ace.renderer;
            popup.setFontSize(ace.getFontSize());
            var lineHeight = renderer.layerConfig.lineHeight;
            
            var base = ace.getCursorPosition();
            base.column -= prefix.length;
            
            // Offset to the left for completion in string, e.g. 'require("a")'
            if (base.column > 0 && line.substr(base.column - 1, 1).match(/["'"]/))
                base.column--;
            
            var loc = ace.renderer.textToScreenCoordinates(base.row, base.column);
            var pos = { left: loc.pageX, top: loc.pageY };
            pos.left -= popup.getTextLeftOffset();
            tooltipHeightAdjust = 0;

            popup.show(pos, lineHeight);
            adjustToToolTipHeight(tooltip.getHeight());
            updateDoc(true);
            
            ignoreMouseOnce = !isPopupVisible();
        }
        
        function adjustToToolTipHeight(height) {
            // Give function to tooltip to adjust completer
            tooltip.adjustCompleterTop = adjustToToolTipHeight;
            
            if (!isPopupVisible())
                return;
            
            var left = parseInt(popup.container.style.left, 10);
            if (popup.isTopdown !== tooltip.isTopdown() || left > tooltip.getRight())
                height = 0;
            
            if (popup.isTopdown) {
                var top = parseInt(popup.container.style.top, 10) - tooltipHeightAdjust;
                height -= height ? 3 : 0;
                top += height;
                popup.container.style.top = top + "px";
            }
            else {
                var bottom = parseInt(popup.container.style.bottom, 10) - tooltipHeightAdjust;
                bottom += height;
                popup.container.style.bottom = bottom + "px";
            }
            tooltipHeightAdjust = height;
            if (isDocShown)
                showDocPopup();
        }
    
        function closeCompletionBox(event) {
            if (!popup)
                return;
            
            if (event && event.target) {
                if (popup.container.contains(event.target)
                  || docElement.contains(event.target))
                    return;
            }
            
            popup.hide();
            hideDocPopup();
            
            if (!lastAce) // no editor, try again later
                return;
                
            var ace = lastAce;
            window.document.removeEventListener("mousedown", closeCompletionBox);
            ace.off("mousewheel", closeCompletionBox);
            
            if (oldCommandKey) {
                ace.keyBinding.onCommandKey = oldCommandKey;
                ace.keyBinding.onTextInput = oldOnTextInput;
            }
            oldCommandKey = oldOnTextInput = null;
            undrawDocInvoke.schedule(HIDE_DOC_DELAY);
        }
            
        function populateCompletionBox(ace, matches) {
            // Get context info
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getLine(pos.row);
            var idRegex = getIdentifierRegex(null, ace) || DEFAULT_ID_REGEX;
            var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            
            // Set the highlight metadata
            popup.ace = ace;
            popup.matches = matches;
            popup.prefix = prefix;
            
            popup.ignoreGenericMatches = isIgnoreGenericEnabled(matches);
            if (popup.ignoreGenericMatches) {
                // Experiment: disable generic matches when possible
                matches = popup.matches = matches.filter(function(m) { return !m.isGeneric; });
            }
            popup.calcPrefix = function(regex){
                return completeUtil.retrievePrecedingIdentifier(line, pos.column, regex);
            };
            popup.setData(matches);
            popup.setRow(0);
        }
        
        function isIgnoreGenericEnabled(matches) {
            var isNonGenericAvailable = false;
            var isContextualAvailable = false;
            for (var i = 0; i < matches.length; i++) {
                if (!matches[i].isGeneric)
                    isNonGenericAvailable = true;
                if (matches[i].isContextual)
                    isContextualAvailable = true;
            }
            return isNonGenericAvailable && isContextualAvailable;
        }
        
        function updateDoc(delayPopup) {
            docElement.innerHTML = '<span class="code_complete_doc_body">';
            var matches = popup.matches;
            var selected = matches && (
                matches[popup.getHoveredRow()] || matches[popup.getRow()]);

            if (!selected)
                return;
            var docHead;
            if (selected.type) {
                var shortType = completedp.guidToShortString(selected.type);
                if (shortType) {
                    docHead = selected.name + " : " 
                        + completedp.guidToLongString(selected.type) + "</div>";
                }
            }
            
            selected.$doc = "";
            
            if (selected.doc)
                selected.$doc = '<p>' + selected.doc + '</p>';
                
            if (selected.icon || selected.type)
                selected.$doc = '<div class="code_complete_doc_head">' 
                    + (selected.docHead || docHead || selected.name) + '</div>' 
                    + (selected.$doc || "");
            
            if (selected && selected.doc) {
                if (isDocShown) {
                    showDocPopup();
                }
                else {
                    hideDocPopup();
                    if (!isDrawDocInvokeScheduled || delayPopup)
                        drawDocInvoke.schedule(SHOW_DOC_DELAY);
                }
                docElement.innerHTML += selected.$doc + '</span>';
            }
            else {
                hideDocPopup();
            }
            if (selected && selected.docUrl)
                docElement.innerHTML += '<p><a' +
                    ' onclick="require(\'ext/preview/preview\').preview(\'' + selected.docUrl + '\'); return false;"' +
                    ' href="' + selected.docUrl + '" target="c9doc">(more)</a></p>';
            docElement.innerHTML += '</span>';
        }
        
        function showDocPopup() {
            var rect = popup.container.getBoundingClientRect();
            if (!txtCompleterDoc.parentNode) {
                document.body.appendChild(txtCompleterDoc);                
            }
            txtCompleterDoc.style.top = popup.container.style.top;
            txtCompleterDoc.style.bottom = popup.container.style.bottom;
            
            if (window.innerWidth - rect.right < 320) {
                txtCompleterDoc.style.right = window.innerWidth - rect.left + "px";
                txtCompleterDoc.style.left = "";
            } else {
                txtCompleterDoc.style.left = (rect.right + 1) + "px";
                txtCompleterDoc.style.right = "";
            }
            txtCompleterDoc.style.height = rect.height + "px";
            txtCompleterDoc.style.display = "block";
        }
        
        function hideDocPopup() {
            txtCompleterDoc.style.display = "none";
        }
    
        function onTextInput(text, pasted) {
            var keyBinding = lastAce.keyBinding;
            oldOnTextInput.apply(keyBinding, arguments);
            if (!pasted) {
                var matched = false;
                for (var i = 0; i < matches.length && !matched; i++) {
                    var idRegex = matches[i].identifierRegex || getIdentifierRegex() || DEFAULT_ID_REGEX;
                    matched = idRegex.test(text);
                }
                if (matched)
                    deferredInvoke();
                else
                    closeCompletionBox();
            }
        }
    
        function onKeyPress(e, hashKey, keyCode) {
            if (keyCode && (e.metaKey || e.ctrlKey || e.altKey)) {
                if (!e.altKey || keyCode != 32)
                    closeCompletionBox();
                return;
            }
            
            var keyBinding = lastAce.keyBinding;
    
            switch(keyCode) {
                case 0: break;
                case 32: // Space
                case 35: // End
                case 36: // Home
                    closeCompletionBox();
                    break;
                case 27: // Esc
                    closeCompletionBox();
                    e.preventDefault();
                    break;
                case 8: // Backspace
                    oldCommandKey.apply(keyBinding, arguments);
                    deferredInvoke();
                    e.preventDefault();
                    break;
                case 37:
                case 39:
                    oldCommandKey.apply(keyBinding, arguments);
                    closeCompletionBox();
                    e.preventDefault();
                    break;
                case 13: // Enter
                case 9: // Tab
                    var ace = lastAce;
                    if (!enterCompletion && keyCode === 13) {
                        oldCommandKey(e, hashKey, keyCode);
                        closeCompletionBox();
                        break;
                    }
                    closeCompletionBox();
                    replaceText(ace, matches[popup.getRow()], e.shiftKey);
                    e.preventDefault();
                    e.stopImmediatePropagation && e.stopImmediatePropagation();
                    break;
                case 40: // Down
                    isDocShown = true;
                    var time = new Date().getTime();
                    if (popup.getRow() == popup.matches.length - 1) {
                        if ((popup.onLastLine && !(lastUpDownEvent + REPEAT_IGNORE_RATE > time))
                            || popup.matches.length === 1)
                            return closeCompletionBox();
                        popup.onLastLine = true;
                    }
                    lastUpDownEvent = time;
                    if (!popup.onLastLine)
                        popup.setRow(popup.getRow() + 1);
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 38: // Up
                    isDocShown = true;
                    var time = new Date().getTime();
                    if ((!popup.getRow() && !(lastUpDownEvent + REPEAT_IGNORE_RATE > time))
                        || popup.matches.length === 1)
                        return closeCompletionBox();
                    lastUpDownEvent = time;
                    if (popup.getRow())
                        popup.setRow(popup.getRow() - 1);
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 33: // PageUp
                    popup.gotoPageUp();
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 34: // PageDown
                    popup.gotoPageDown();
                    e.stopPropagation();
                    e.preventDefault();
                    break;
            }
        }
        
        function invoke(forceBox, deleteSuffix) {
            var tab = tabs.focussedTab;
            if (!tab || !language.isEditorSupported(tab))
                return;
            
            var ace = lastAce = tab.editor.ace;
            
            if (ace.inMultiSelectMode) {
                closeCompletionBox();
                return;
            }
            ace.addEventListener("change", deferredInvoke);
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getLine(pos.row);
            worker.emit("complete", { data: {
                pos: pos,
                staticPrefix: c9.staticPrefix,
                line: line,
                forceBox: true,
                deleteSuffix: true
            }});
            if (forceBox)
                killCrashedCompletionInvoke(CRASHED_COMPLETION_TIMEOUT);
        }
        
        function onComplete(event, editor) {
            if (!lastAce || lastAce != editor.ace) {
                console.error("[complete] received completion for wrong ace");
                return;
            }
            
            var pos = editor.ace.getCursorPosition();
            var line = editor.ace.getSession().getLine(pos.row);
            
            editor.ace.removeEventListener("change", deferredInvoke);
            killCrashedCompletionInvoke.cancel();
    
            if (!completeUtil.canCompleteForChangedLine(event.data.line, line, event.data.pos, pos, getIdentifierRegex(null, editor.ace)))
                 return;
            if (event.data.isUpdate && !isPopupVisible())
                return;
    
            var matches = eventMatches = event.data.matches;
            if (event.data.line !== line)
                matches = filterMatches(matches, line, pos);
            
            if (matches.length === 1 && !event.data.forceBox) {
                replaceText(editor.ace, matches[0], event.data.deleteSuffix);
            }
            else if (matches.length > 0) {
                var idRegex = matches[0].identifierRegex || getIdentifierRegex() || DEFAULT_ID_REGEX;
                var identifier = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
                if (matches.length === 1 && (identifier === matches[0].replaceText || identifier + " " === matches[0].replaceText))
                    closeCompletionBox();
                else
                    showCompletionBox(editor, matches, identifier, line);
            }
            else {
                closeCompletionBox();
            }
        }
        
        function setEnterCompletion(enabled) {
            enterCompletion = enabled;
        }
            
        /**
         * Incrementally update completion results while waiting for the worker.
         */
        function onCompleteUpdate() {
            var ace = lastAce;
            if (!isPopupVisible() || !eventMatches)
                return;
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getLine(pos.row);
            var idRegex = getIdentifierRegex() || DEFAULT_ID_REGEX;
            var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            var matches = filterMatches(eventMatches, line, pos);
            if (matches.length)
                showCompletionBox({ace: ace}, matches, prefix, line);
        }
        
        function filterMatches(matches, line, pos) {
            return matches.filter(function(match) {
                var idRegex = match.identifierRegex || getIdentifierRegex() || DEFAULT_ID_REGEX;
                var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
                return match.name.indexOf(prefix) === 0;
            });
        }
    
        /***** Methods *****/
        
        function deferredInvoke(now, ace) {
            ace = ace || lastAce;
            now = now || !isPopupVisible();
            var delay = now  ? 0 : AUTO_UPDATE_DELAY;
            if (!now) {
                // Fire incremental update after document changes are known
                setTimeout(onCompleteUpdate.bind(this), 0);
            }
            if (isInvokeScheduled)
                return;
            isInvokeScheduled = true;
            deferredInvoker.ace = ace;
            deferredInvoker.schedule(delay);
        }
        
        function getContinousCompletionRegex(language, ace) {
            return completionRegexes[language || getSyntax(ace || lastAce)];
        }
        
        function getIdentifierRegex(language, ace) {
            return idRegexes[language || getSyntax(ace || lastAce)];
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
            drawn = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Manages the code completer popup.
         **/
        plugin.freezePublicAPI({
            /**
             * Invoke the completer after a small delay,
             * if there is a matching language handler that
             * agrees to complete at the current cursor position.
             *
             * @param {Boolean} now   Show without delay
             * @param {ace}     ace   The current tab's editor.ace object
             */
            deferredInvoke : deferredInvoke,
            
            /**
             * @ignore
             */
            getContinousCompletionRegex: getContinousCompletionRegex,
            
            /**
             * @ignore
             */
            getIdentifierRegex: getIdentifierRegex,
            
            /**
             * Close the completion popup.
             */
            closeCompletionBox : closeCompletionBox,
            
            /**
             * Determines whether a completion popup is currently visible.
             */
            isPopupVisible : isPopupVisible,
            
            /**
             * @internal
             */
            setEnterCompletion : setEnterCompletion
        });
        
        register(null, {
            "language.complete": plugin
        });
    }
});
