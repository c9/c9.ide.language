/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "plugin", "ui", "tabs", "ace", "language",
        "menus", "commands", "c9", "tabs", "browsersupport"
    ];
    main.provides = ["language.complete"];
    return main;

    function main(options, imports, register) {
        var Plugin     = imports.plugin;
        var ui         = imports.ui;
        var c9         = imports.c9;
        var aceHandle  = imports.ace;
        var menus      = imports.menus;
        var tabs       = imports.tabs;
        var commands   = imports.commands;
        var language   = imports.language;
        var browsers   = imports.browsersupport;
        
        var lang           = require("ace/lib/lang");
        var dom            = require("ace/lib/dom");
        var SyntaxDetector = require("./syntax_detector");
        var completeUtil   = require("../c9.ide.language.generic/complete_util");
        var Tree           = require("ace_tree/tree");
        var ListData       = require("./completedp");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var isInvokeScheduled = false;
        var ignoreMouseOnce = false;
        var enterCompletion = true;
        
        var oldCommandKey, oldOnTextInput, isDocShown;
        var txtCompleter, barCompleterCont, txtCompleterHolder, txtCompleterDoc; // ui elements
        var selectedIdx, scrollIdx, matchEls, matches, completionElement;
        var docElement, cursorConfig, lineHeight, lastAce, forceBox, worker; 
        var eventMatches, tree, ldSearch;
        
        var idRegexes         = {};
        var completionRegexes = {}; 
        
        const DEFAULT_ID_REGEX = /[a-zA-Z_0-9\$\/]/;
        
        const SHOW_DOC_DELAY = 1500;
        const SHOW_DOC_DELAY_MOUSE_OVER = 100;
        const HIDE_DOC_DELAY = 1000;
        const AUTO_UPDATE_DELAY = 200;
        const CRASHED_COMPLETION_TIMEOUT = 6000;
        const MENU_WIDTH = 330;
        const MENU_SHOWN_ITEMS = 8;
        const EXTRA_LINE_HEIGHT = 4;
        
        const deferredInvoker = lang.deferredCall(function() {
            isInvokeScheduled = false;
            var editor = deferredInvoker.ace;
            var pos = editor.getCursorPosition();
            var line = editor.getSession().getDocument().getLine(pos.row);
            var regex = getIdentifierRegex(null, editor) || DEFAULT_ID_REGEX;
            if (completeUtil.precededByIdentifier(line, pos.column) ||
               (line[pos.column - 1] === '.' && (!line[pos.column] || !line[pos.column].match(regex))) ||
               (line[pos.column - 1] && line[pos.column - 1].match(regex)
               ) || // TODO: && keyhandler.inCompletableCodeContext(line, pos.column)) ||
               (language.isInferAvailable() && completeUtil.isRequireJSCall(line, pos.column, "", editor))) {
                invoke(true);
            }
            else {
                closeCompletionBox();
            }
        });
        const drawDocInvoke = lang.deferredCall(function() {
            if (isPopupVisible() && matches[selectedIdx].doc) {
                isDocShown = true;
                txtCompleterDoc.parentNode.style.display = "block";
            }
            isDrawDocInvokeScheduled = false;
        });
        const isDrawDocInvokeScheduled = false;
        
        const undrawDocInvoke = lang.deferredCall(function() {
            if (!isPopupVisible()) {
                isDocShown = false;
                txtCompleterDoc.parentNode.style.display = "none";
            }
        });
        
        const killCrashedCompletionInvoke = lang.deferredCall(function() {
            closeCompletionBox();
        });
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            language.on("worker.init", function(e){
                worker = e.worker;
                
                worker.on("setIdentifierRegex", function(event) {
                    idRegexes[event.data.language] = event.data.identifierRegex;
                });
                worker.on("setCompletionRegex", function(event) {
                    completionRegexes[event.data.language] = event.data.completionRegex;
                }); 
                
                e.worker.on("complete", function(event) {
                    if (language.disabled || plugin.disabled) return;
                    
                    var page = tabs.findPage(event.data.path);
                    if (!page) return;
                    
                    var editor = page.editor;
                    onComplete(event, editor);
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
                    return editor && editor.type == "ace"
                },
                exec : invoke
            }, plugin);
        }
        
        var drawn;
        function draw(){
            if (drawn) return;
            drawn = true;
        
            // Import the CSS for the completion box
            ui.insertCss(require("text!./complete.css"), plugin);
            
            // UI
            var n = ui.insertHtml(null, require("text!./complete.html"), plugin);
            
            barCompleterCont   = n[0];
            txtCompleterHolder = barCompleterCont.firstElementChild;
            txtCompleter       = txtCompleterHolder.firstElementChild;
            txtCompleterDoc    = barCompleterCont.lastElementChild.lastElementChild;
            
            // Create the Ace Tree
            tree      = new Tree(txtCompleter);
            ldSearch  = new ListData();
            
            // Assign the dataprovider
            tree.setDataProvider(ldSearch);
            
            // Some global render metadata
            ldSearch.staticPrefix = options.staticPrefix;
            
            var ieStyle = "";
            if (browsers.getIEVersion() === 9)
                ieStyle = 'style="position: relative; top: -4px;"';
            else if (browsers.getIEVersion() === 10)
                ieStyle = 'style="position: relative; top: -5px;"';
            ldSearch.ieStyle = ieStyle;
            
            //@TODO DEPRECATE: onKeyPress
            
            // Ace Tree Interaction
            txtCompleter.addEventListener("mouseover", function() {
                if (ignoreMouseOnce) {
                    ignoreMouseOnce = false;
                    return;
                }
                
                // updateDoc();
                // if (!isDrawDocInvokeScheduled)
                //     drawDocInvoke.schedule(SHOW_DOC_DELAY_MOUSE_OVER);
            }, false);
            txtCompleter.addEventListener("click", function() {
                var match = ldSearch.matches[ldSearch.selectedRow];
                replaceText(ldSearch.ace, match);
                ldSearch.ace.focus();
            }, false);
            ldSearch.on("select", function(){
                updateDoc(true);
            });
            
            emit("draw");
        }
        
        /***** Helper Functions *****/
        
        function isPopupVisible() {
            return barCompleterCont && barCompleterCont.style.display === "block";
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
        function replaceText(ace, match) {
            var newText = match.replaceText;
            var pos = ace.getCursorPosition();
            var session = ace.getSession();
            var line = session.getLine(pos.row);
            var doc = session.getDocument();
            var idRegex = match.identifierRegex || getIdentifierRegex(null, ace) || DEFAULT_ID_REGEX;
            var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            
            if (match.replaceText === "require(^^)" && isJavaScript(ace)) {
                newText = "require(\"^^\")";
                if (!isInvokeScheduled)
                    setTimeout(deferredInvoke, 0);
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
        
            var postfix = completeUtil.retrieveFollowingIdentifier(line, pos.column, idRegex) || "";
            
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
        
            doc.removeInLine(pos.row, pos.column - prefix.length, pos.column + postfix.length);
            doc.insert({row: pos.row, column: pos.column - prefix.length}, paddedLines);
        
            var cursorCol = rowOffset ? colOffset : pos.column + colOffset - prefix.length;
            var cursorCol2 = rowOffset2 ? colOffset2 : pos.column + colOffset2 - prefix.length;
        
            if (line.substring(0, pos.column).match(/require\("[^\"]+$/) && isJavaScript()) {
                if (line.substr(pos.column + postfix.length, 1).match(/['"]/) || paddedLines.substr(0, 1) === '"')
                    cursorCol++;
                if (line.substr(pos.column + postfix.length + 1, 1) === ')')
                    cursorCol++;
            }
            var cursorPos = { row: pos.row + rowOffset, column: cursorCol };
            var cursorPos2 = { row: pos.row + rowOffset2, column: cursorCol2 };
            ace.selection.setSelectionRange({ start: cursorPos, end: cursorPos2 });
        }
        
        function showCompletionBox(editor, m, prefix, line, column) {
            var ace = editor.ace;
            draw();
            
            //ace.container.parentNode.appendChild(barCompleterCont);
            
            selectedIdx       = 0;
            scrollIdx         = 0;
            matchEls          = [];
            matches           = m;
            docElement        = txtCompleterDoc;
            cursorConfig      = ace.renderer.$cursorLayer.config;
            lineHeight        = cursorConfig.lineHeight + EXTRA_LINE_HEIGHT;
            completionElement = txtCompleter;
            
            var style = dom.computedStyle(ace.container);
            completionElement.style.fontSize = style.fontSize;
            
            // Monkey patch
            if (!oldCommandKey) {
                oldCommandKey = ace.keyBinding.onCommandKey;
                ace.keyBinding.onCommandKey = onKeyPress.bind(this);
                oldOnTextInput = ace.keyBinding.onTextInput;
                ace.keyBinding.onTextInput = onTextInput.bind(this);
            }
            
            lastAce = ace;
            
            populateCompletionBox(ace, matches);
            document.addEventListener("click", closeCompletionBox);
            ace.container.addEventListener("DOMMouseScroll", closeCompletionBox);
            ace.container.addEventListener("mousewheel", closeCompletionBox);
            
            var boxLength = matches.length || 1;
            var completionBoxHeight = 11 + Math.min(MENU_SHOWN_ITEMS * lineHeight + 0, boxLength * (lineHeight));
            var cursorLayer = ace.renderer.$cursorLayer;
            
            var innerBoxLength = matches.length || 1;
            var ieBonus;
            if (browsers.getIEVersion() === 9) {
                ieBonus = 8 * Math.min(MENU_SHOWN_ITEMS, innerBoxLength);
            }
            else if (browsers.getIEVersion() === 10) {
                ieBonus = 7 * Math.min(MENU_SHOWN_ITEMS, innerBoxLength);
            }
            var innerCompletionBoxHeight = Math.min(MENU_SHOWN_ITEMS * lineHeight + 0, innerBoxLength * (lineHeight)) + ieBonus;
            txtCompleterHolder.style.height = innerCompletionBoxHeight + "px";
            
            txtCompleterDoc.parentNode.style.left = innerCompletionBoxHeight < 100 ? "285px" : "275px";
            
            ignoreMouseOnce = !isPopupVisible();
            
            var pos = cursorLayer.cursor.getBoundingClientRect();
            
            barCompleterCont.style.height = completionBoxHeight + "px";
            barCompleterCont.style.width  = MENU_WIDTH + "px";
            
            if (!isPopupVisible()) {
                barCompleterCont.style.left   = (pos.left + (prefix.length * -cursorConfig.characterWidth) - 24) + "px";
                barCompleterCont.style.display = "block";
            }
            
            // Above the cursor
            if (window.innerHeight < pos.top + cursorConfig.lineHeight + 1 + barCompleterCont.offsetHeight) {
                barCompleterCont.style.top = (pos.top - barCompleterCont.offsetHeight + 6) + "px";
                ui.addClass(barCompleterCont, "upward");
                // txtCompleterDoc.parentNode.style.top = innerCompletionBoxHeight < 100 ? "auto" : "15px";
                // txtCompleterDoc.parentNode.style.bottom = innerCompletionBoxHeight < 100 ? "7px" : "23px";
            }
            // Below the cursor
            else {
                barCompleterCont.style.top = (pos.top + cursorConfig.lineHeight + 1) + "px";
                ui.removeClass(barCompleterCont, "upward");
                // txtCompleterDoc.parentNode.style.top = innerCompletionBoxHeight < 100 ? "0" : "15px";
                // txtCompleterDoc.parentNode.style.bottom = "23px";
            }
            
//            barCompleterCont.setHeight(completionBoxHeight);
//            barCompleterCont.$ext.style.height = completionBoxHeight + "px";
//            // HACK: Need to set with non-falsy value first
//            completionElement.scrollTop = 1;
//            completionElement.scrollTop = 0;

            tree.resize();
        }
    
        function closeCompletionBox(event) {
            if (!barCompleterCont)
                return;

            barCompleterCont.style.display = "none";
            
            if (!lastAce) // no editor, try again later
                return;
                
            var ace = lastAce;
            document.removeEventListener("click", closeCompletionBox);
            ace.container.removeEventListener("DOMMouseScroll", closeCompletionBox);
            ace.container.removeEventListener("mousewheel", closeCompletionBox);
            
            if (oldCommandKey) {
                ace.keyBinding.onCommandKey = oldCommandKey;
                ace.keyBinding.onTextInput = oldOnTextInput;
            }
            oldCommandKey = oldOnTextInput = null;
            undrawDocInvoke.schedule(HIDE_DOC_DELAY);
            
            lastAce = null;
        }
            
        function populateCompletionBox(ace, matches) {
            // Populate the completion box
            ldSearch.updateData(matches);
            
            // Get context info
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getLine(pos.row);
            var idRegex = getIdentifierRegex(null, ace) || DEFAULT_ID_REGEX;
            var prefix = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            
            // Set the highlight metadata
            ldSearch.ace              = ace;
            ldSearch.matches          = matches;
            ldSearch.prefix           = prefix;
            ldSearch.isInferAvailable = language.isInferAvailable();
            ldSearch.calcPrefix       = function(regex){
                completeUtil.retrievePrecedingIdentifier(line, pos.column, regex);
            };
            
            //@Harutyun set scrolltop to 0
            
            ldSearch.select(0);
        }
        
        function updateDoc(delayPopup) {
            docElement.innerHTML = '<span class="code_complete_doc_body">';
            
            var selected = ldSearch.matches[ldSearch.selectedRow];
            if (selected && selected.$doc) {
                if (isDocShown) {
                    txtCompleterDoc.parentNode.style.display = "block";
                }
                else {
                    txtCompleterDoc.parentNode.style.display = "none";
                    if (!isDrawDocInvokeScheduled || delayPopup)
                        drawDocInvoke.schedule(SHOW_DOC_DELAY);
                }
                docElement.innerHTML += selected.$doc + '</span>';
            }
            else {
                txtCompleterDoc.parentNode.style.display = "none";
            }
            if (selected && selected.docUrl)
                docElement.innerHTML += '<p><a' +
                    ' onclick="require(\'ext/preview/preview\').preview(\'' + selected.docUrl + '\'); return false;"' +
                    ' href="' + selected.docUrl + '" target="c9doc">(more)</a></p>';
            docElement.innerHTML += '</span>';
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
                    replaceText(ace, matches[ldSearch.selectedRow]);
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    break;
                case 40: // Down
                    tree.execCommand("goDown");
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 38: // Up
                    tree.execCommand("goUp");
                    e.stopPropagation();
                    e.preventDefault();
                    break;
            }
        }
        
        function invoke(forceBox) {
            var page = tabs.focussedPage;
            if (!page || page.editor.type != "ace") return;
            
            var ace = lastAce = page.editor.ace;
            
            if (ace.inMultiSelectMode) {
                closeCompletionBox();
                return;
            }
            ace.addEventListener("change", deferredInvoke);
            var pos = ace.getCursorPosition();
            var line = ace.getSession().getLine(pos.row);
            worker.emit("complete", { data: { pos: pos, staticPrefix: c9.staticPrefix, line: line, forceBox: true }});
            if (forceBox)
                killCrashedCompletionInvoke(CRASHED_COMPLETION_TIMEOUT);
        }
        
        function onComplete(event, editor) {
            var pos = editor.ace.getCursorPosition();
            var eventPos = event.data.pos;
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
                replaceText(editor.ace, matches[0]);
            }
            else if (matches.length > 0) {
                var idRegex = matches[0].identifierRegex || getIdentifierRegex() || DEFAULT_ID_REGEX;
                var identifier = completeUtil.retrievePrecedingIdentifier(line, pos.column, idRegex);
            if (matches.length === 1 && identifier === matches[0].replaceText)
                closeCompletionBox();
            else
                showCompletionBox(editor, matches, identifier);
            }
            else {
                if (typeof barCompleterCont !== 'undefined')
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
                showCompletionBox({ace: ace}, matches, prefix);
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
         * Draws the file tree
         * @event afterfilesave Fires after a file is saved
         *   object:
         *     node     {XMLNode} description
         *     oldpath  {String} description
         **/
        plugin.freezePublicAPI({
            /**
             */
            deferredInvoke : deferredInvoke,
            
            /**
             */
            getContinousCompletionRegex: getContinousCompletionRegex,
            
            /**
             */
            getIdentifierRegex: getIdentifierRegex,
            
            /**
             * 
             */
            closeCompletionBox : closeCompletionBox,
            
            /**
             * 
             */
            setEnterCompletion : setEnterCompletion
        });
        
        register(null, {
            "language.complete": plugin
        });
    }
});