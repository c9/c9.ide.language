define(function(require, exports, module) {

var ID_REGEX = /[a-zA-Z_0-9\$]/;
var REQUIRE_ID_REGEX = /(?!["'])./;

function retrievePrecedingIdentifier(text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos-1; i >= 0; i--) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf.reverse().join("");
}

function retrieveFollowingIdentifier(text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos; i < text.length; i++) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf;
}

function prefixBinarySearch(items, prefix) {
    var startIndex = 0;
    var stopIndex = items.length - 1;
    var middle = Math.floor((stopIndex + startIndex) / 2);
    
    while (stopIndex > startIndex && middle >= 0 && items[middle].indexOf(prefix) !== 0) {
        if (prefix < items[middle]) {
            stopIndex = middle - 1;
        }
        else if (prefix > items[middle]) {
            startIndex = middle + 1;
        }
        middle = Math.floor((stopIndex + startIndex) / 2);
    }
    
    // Look back to make sure we haven't skipped any
    while (middle > 0 && items[middle-1].indexOf(prefix) === 0)
        middle--;
    return middle >= 0 ? middle : 0; // ensure we're not returning a negative index
}

function findCompletions(prefix, allIdentifiers) {
    allIdentifiers.sort();
    var startIdx = prefixBinarySearch(allIdentifiers, prefix);
    var matches = [];
    for (var i = startIdx; i < allIdentifiers.length && allIdentifiers[i].indexOf(prefix) === 0; i++)
        matches.push(allIdentifiers[i]);
    return matches;
}

function fetchText(staticPrefix, path) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', staticPrefix + "/" + path, false);
    try {
        xhr.send();
    }
    // Likely we got a cross-script error (equivalent with a 404 in our cloud setup)
    catch(e) {
        return false;
    }
    if (xhr.status === 200)
        return xhr.responseText;
    else
        return false;
}

/**
 * Determine if code completion results triggered for oldLine/oldPos
 * would still be applicable for newLine/newPos
 * (assuming you would filter them for things that no longer apply).
 */
function canCompleteForChangedLine(oldLine, newLine, oldPos, newPos, identifierRegex) {
    if (oldPos.row !== newPos.row)
        return false;
    
    if (oldLine === newLine)
        return true;
        
    if (newLine.indexOf(oldLine) !== 0)
        return false;
        
    var oldPrefix = retrievePrecedingIdentifier(oldLine, oldPos.column, identifierRegex);
    var newPrefix = retrievePrecedingIdentifier(newLine, newPos.column, identifierRegex);
    return newLine.substr(0, newLine.length - newPrefix.length) === oldLine.substr(0, oldLine.length - oldPrefix.length);
}

function precededByIdentifier(line, column, postfix, ace) {
    var id = retrievePrecedingIdentifier(line, column);
    if (postfix) id += postfix;
    return id !== "" && !(id[0] >= '0' && id[0] <= '9') 
        && (inCompletableCodeContext(line, column, id) 
        || isRequireJSCall(line, column, id, ace));
}

function isRequireJSCall(line, column, identifier, ace) {
    if (ace.getSession().syntax !== "javascript")
        return false;
    var id = identifier || retrievePrecedingIdentifier(line, column, REQUIRE_ID_REGEX);
    var LENGTH = 'require("'.length;
    var start = column - id.length - LENGTH;

    return start >= 0 && line.substr(start, LENGTH).match(/require\(["']/)
        || line.substr(start + 1, LENGTH).match(/require\(["']/);
}

/**
 * Ensure that code completion is not triggered.
 */
function inCompletableCodeContext(line, column, id) {
    var inMode = null;
    if (line.match(/^\s*\*.+/))
        return false;
    for (var i = 0; i < column; i++) {
        if(line[i] === '"' && !inMode)
            inMode = '"';
        else if(line[i] === '"' && inMode === '"' && line[i-1] !== "\\")
            inMode = null;
        else if(line[i] === "'" && !inMode)
            inMode = "'";
        else if(line[i] === "'" && inMode === "'" && line[i-1] !== "\\")
            inMode = null;
        else if(line[i] === "/" && line[i+1] === "/") {
            inMode = '//';
            i++;
        }
        else if(line[i] === "/" && line[i+1] === "*" && !inMode) {
            if (line.substr(i + 2, 6) === "global")
                continue;
            inMode = '/*';
            i++;
        }
        else if(line[i] === "*" && line[i+1] === "/" && inMode === "/*") {
            inMode = null;
            i++;
        }
        else if(line[i] === "/" && !inMode)
            inMode = "/";
        else if(line[i] === "/" && inMode === "/" && line[i-1] !== "\\")
            inMode = null;
    }
    return !inMode;
}

/** @deprecated Use retrievePrecedingIdentifier */
exports.retrievePreceedingIdentifier = function() {
    console.error("Deprecated: 'retrievePreceedingIdentifier' - use 'retrievePrecedingIdentifier' instead"); 
    return retrievePrecedingIdentifier.apply(null, arguments);
};
exports.precededByIdentifier = precededByIdentifier;
exports.isRequireJSCall = isRequireJSCall;
exports.retrievePrecedingIdentifier = retrievePrecedingIdentifier;
exports.retrieveFollowingIdentifier = retrieveFollowingIdentifier;
exports.findCompletions = findCompletions;
exports.fetchText = fetchText;
exports.DEFAULT_ID_REGEX = ID_REGEX;
exports.canCompleteForChangedLine = canCompleteForChangedLine;
});