var fs     = require('fs'),
mkdirp = require('mkdirp'),
_      = require('lodash'),
path   = require('path'),
async  = require('async'),
hat    = require('hat');

//package that sends notifications via slack api
const nodeSlack =  require("node-slack");

require('string.prototype.startswith');

var UNDEFINED, exportObject = exports, reportDate;

function sanitizeFilename(name){
name = name.replace(/\s+/gi, '-'); // Replace white space with dash
return name.replace(/[^a-zA-Z0-9\-]/gi, ''); // Strip any special charactere
}
function trim(str) { return str.replace(/^\s+/, "" ).replace(/\s+$/, "" ); }
function elapsed(start, end) { return (end - start)/1000; }
function isFailed(obj) { return obj.status === "failed"; }
function isSkipped(obj) { return obj.status === "pending"; }
function isDisabled(obj) { return obj.status === "disabled"; }
function parseDecimalRoundAndFixed(num,dec){
var d =  Math.pow(10,dec);
return isNaN((Math.round(num * d) / d).toFixed(dec)) === true ? 0 : (Math.round(num * d) / d).toFixed(dec);
}
function extend(dupe, obj) { // performs a shallow copy of all props of `obj` onto `dupe`
for (var prop in obj) {
    if (obj.hasOwnProperty(prop)) {
        dupe[prop] = obj[prop];
    }
}
return dupe;
}
function escapeInvalidHtmlChars(str) {
return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function getQualifiedFilename(path, filename, separator) {
if (path && path.substr(-1) !== separator && filename.substr(0) !== separator) {
    path += separator;
}
return path + filename;
}
function log(str) {
var con = global.console || console;
if (con && con.log) {
    con.log(str);
}
}
function rmdir(dir) {
try {
    var list = fs.readdirSync(dir);
    for (var i = 0; i < list.length; i++) {
        var filename = path.join(dir, list[i]);
        var stat = fs.statSync(filename);

        if (stat.isDirectory()) {
            // rmdir recursively
            rmdir(filename);
        } else {
            // rm fiilename
            fs.unlinkSync(filename);
        }
    }
    fs.rmdirSync(dir);
}catch (e) { log("problem trying to remove a folder:" + dir); }
}

function getReportDate(){
if (reportDate === undefined)
    reportDate = new Date();
return reportDate.getFullYear() + '' +
        (reportDate.getMonth() + 1) +
        reportDate.getDate() + ' ' +
        reportDate.getHours() + '' +
        reportDate.getMinutes() + '' +
        reportDate.getSeconds() + ',' +
        reportDate.getMilliseconds();
}


function Jasmine2HTMLReporter(options) {

var self = this;

self.started = false;
self.finished = false;
// sanitize arguments
options = options || {};
self.takeScreenshots = options.takeScreenshots === UNDEFINED ? true : options.takeScreenshots;
self.savePath = options.savePath || '';
self.takeScreenshotsOnlyOnFailures = options.takeScreenshotsOnlyOnFailures === UNDEFINED ? false : options.takeScreenshotsOnlyOnFailures;
self.screenshotsFolder = (options.screenshotsFolder || 'screenshots').replace(/^\//, '') + '/';
self.useDotNotation = options.useDotNotation === UNDEFINED ? true : options.useDotNotation;
self.fixedScreenshotName = options.fixedScreenshotName === UNDEFINED ? false : options.fixedScreenshotName;
self.consolidate = options.consolidate === UNDEFINED ? true : options.consolidate;
self.consolidateAll = self.consolidate !== false && (options.consolidateAll === UNDEFINED ? true : options.consolidateAll);
self.fileNameSeparator = options.fileNameSeparator === UNDEFINED ? '-' : options.fileNameSeparator;
self.fileNamePrefix = options.fileNamePrefix === UNDEFINED ? '' : options.fileNamePrefix;
self.fileNameSuffix = options.fileNameSuffix === UNDEFINED ? '' : options.fileNameSuffix;
self.fileNameDateSuffix = options.fileNameDateSuffix === UNDEFINED ? false : options.fileNameDateSuffix;
self.fileName = options.fileName === UNDEFINED ? 'htmlReport' : options.fileName;
self.cleanDestination = options.cleanDestination === UNDEFINED ? true : options.cleanDestination;
self.showPassed = options.showPassed === UNDEFINED ? true : options.showPassed;
//notify a Slack channel via a webhook url (optionally) e.g., https://hooks.slack.com/services/AAABBBCCC/AAABBBCCCDDEEEFFGGGHHHHIII
self.notifySlack = options.notifySlackUrl === UNDEFINED ? false : new nodeSlack(options.notifySlackUrl);
//if report is served via a webserver, aappend a url in front of report name (e.g, http://reportserver.domain.com/reports/ + the name of report)
self.reportUrl = options.reportUrl === UNDEFINED ? '' : options.reportUrl;
//lightbox shows all the screenshot images inside a lightbox - uses a script, jquery, css, and tags each anchor with data-lightbox="nameofgroup"
self.lightbox = options.lightbox === UNDEFINED ? true : options.lightbox;


var suites = [],
    currentSuite = null,
    totalSpecsExecuted = 0,
    totalSpecsFailed = 0,
    totalSpecsDefined,
    failIndex = 0,
    failedSpecs = [],
    specIndex = 0,
    // when use use fit, jasmine never calls suiteStarted / suiteDone, so make a fake one to use
    fakeFocusedSuite = {
        id: 'focused',
        description: 'focused specs',
        fullName: 'focused specs'
    };

var __suites = {}, __specs = {};
function getSuite(suite) {
    __suites[suite.id] = extend(__suites[suite.id] || {}, suite);
    return __suites[suite.id];
}
function getSpec(spec) {
    __specs[spec.id] = extend(__specs[spec.id] || {}, spec);
    return __specs[spec.id];
}

function getReportFilename(specName){
    var name = '';
    console.log(self.fileNamePrefix);
    if (self.fileNamePrefix)
        name += self.fileNamePrefix + self.fileNameSeparator;

    name += self.fileName;

    if (specName !== undefined)
        name += self.fileNameSeparator + specName;

    if (self.fileNameSuffix)
        name += self.fileNameSeparator + self.fileNameSuffix;

    if (self.fileNameDateSuffix)
        name += self.fileNameSeparator + getReportDate();

    return name;
}

self.jasmineStarted = function(summary) {
    totalSpecsDefined = summary && summary.totalSpecsDefined || NaN;
    exportObject.startTime = new Date();
    self.started = true;

    //Delete previous reports unless cleanDirectory is false
    if (self.cleanDestination)
        rmdir(self.savePath);


    if (self.notifySlack) {
        self.notifySlack.send({
            text: "Starting Automated tests with: `" + totalSpecsDefined + " specs` defined",
        });
    }

};

self.suiteStarted = function(suite) {
    suite = getSuite(suite);
    suite._startTime = new Date();
    suite._specs = [];
    suite._suites = [];
    suite._failures = 0;
    suite._skipped = 0;
    suite._disabled = 0;
    suite._parent = currentSuite;
    if (!currentSuite) {
        suites.push(suite);
    } else {
        currentSuite._suites.push(suite);
    }
    currentSuite = suite;
};
self.specStarted = function(spec) {
    if (!currentSuite) {
        // focused spec (fit) -- suiteStarted was never called
        self.suiteStarted(fakeFocusedSuite);
    }
    spec = getSpec(spec);
    spec._startTime = new Date();
    spec._suite = currentSuite;
    currentSuite._specs.push(spec);
};

self.specDone = function(spec) {
    spec = getSpec(spec);
    spec._endTime = new Date();
    if (isSkipped(spec)) { spec._suite._skipped++; }
    if (isDisabled(spec)) { spec._suite._disabled++; }
    if (isFailed(spec)) { spec._suite._failures++; totalSpecsFailed++; failedSpecs.push(spec); }
    totalSpecsExecuted++;

    //Take screenshots taking care of the configuration
    if ((self.takeScreenshots && !self.takeScreenshotsOnlyOnFailures) ||
        (self.takeScreenshots && self.takeScreenshotsOnlyOnFailures && isFailed(spec))) {
        if (!self.fixedScreenshotName)
            spec.screenshot = hat() + '.png';
        else
            spec.screenshot = sanitizeFilename(spec.description) + '.png';

        browser.takeScreenshot().then(function (png) {
            var screenshotPath = path.join(
                self.savePath,
                self.screenshotsFolder,
                spec.screenshot
            );

            mkdirp(path.dirname(screenshotPath), function (err) {
                if (err) {
                    throw new Error('Could not create directory for ' + screenshotPath);
                }
                writeScreenshot(png, screenshotPath);
            });
        });
    }


};
self.suiteDone = function(suite) {
    suite = getSuite(suite);
    if (suite._parent === UNDEFINED) {
        // disabled suite (xdescribe) -- suiteStarted was never called
        self.suiteStarted(suite);
    }
    suite._endTime = new Date();
    currentSuite = suite._parent;
};

self.jasmineDone = function() {
    if (currentSuite) {
        // focused spec (fit) -- suiteDone was never called
        self.suiteDone(fakeFocusedSuite);
    }

    var output = '';
    for (var i = 0; i < suites.length; i++) {
        output += self.getOrWriteNestedOutput(suites[i]);
    }

    var reportFilename = getReportFilename();
    // if we have anything to write here, write out the consolidated file
    if (output) {
        wrapOutputAndWriteFile(reportFilename, output);
    }

    let summaryJasmineDone = "Finished Automated tests. Executed `" + totalSpecsExecuted + " specs, " + totalSpecsFailed + " failures`. Go to " + self.reportUrl + reportFilename+ ".html";
    //log(summaryJasmineDone);
    
    if (self.notifySlack) {
        self.notifySlack.send({
            text: summaryJasmineDone,
        });
    }
    //log("Specs skipped but not reported (entire suite skipped or targeted to specific specs)", totalSpecsDefined - totalSpecsExecuted + totalSpecsDisabled);

    self.finished = true;
    // this is so phantomjs-testrunner.js can tell if we're done executing
    exportObject.endTime = new Date();
};

self.getOrWriteNestedOutput = function(suite) {
    var output = suiteAsHtml(suite);
    for (var i = 0; i < suite._suites.length; i++) {
        output += self.getOrWriteNestedOutput(suite._suites[i]);
    }
    if (self.consolidateAll || self.consolidate && suite._parent) {
        return output;
    } else {
        // if we aren't supposed to consolidate output, just write it now
        wrapOutputAndWriteFile(generateFilename(suite), output);
        return '';
    }
};

/******** Helper functions with closure access for simplicity ********/
function generateFilename(suite) {
    return getReportFilename(getFullyQualifiedSuiteName(suite, true));
}

function getFullyQualifiedSuiteName(suite, isFilename) {
    var fullName;
    if (self.useDotNotation || isFilename) {
        fullName = suite.description;
        for (var parent = suite._parent; parent; parent = parent._parent) {
            fullName = parent.description + '.' + fullName;
        }
    } else {
        fullName = suite.fullName;
    }

    // Either remove or escape invalid HTML characters
    if (isFilename) {
        var fileName = "",
            rFileChars = /[\w\.]/,
            chr;
        while (fullName.length) {
            chr = fullName[0];
            fullName = fullName.substr(1);
            if (rFileChars.test(chr)) {
                fileName += chr;
            }
        }
        return fileName;
    } else {
        return escapeInvalidHtmlChars(fullName);
    }
}

var writeScreenshot = function (data, filename) {
    var stream = fs.createWriteStream(filename);
    stream.write(new Buffer(data, 'base64'));
    stream.end();
};

function suiteAsHtml(suite) {

    var html = '<article class="suite">';
    html += '<header>';
    html += '<h2>' + getFullyQualifiedSuiteName(suite) + ' - ' + elapsed(suite._startTime, suite._endTime) + 's</h2>';
    html += '<ul class="stats">';
    html += '<li>Tests: <strong>' + suite._specs.length + '</strong></li>';
    html += '<li>Skipped: <strong>' + suite._skipped + '</strong></li>';
    html += '<li>Failures: <strong>' + suite._failures + '</strong></li>';
    html += '</ul> </header>';
    
    for (var i = 0; i < suite._specs.length; i++) {
        var spec = suite._specs[i];
        specIndex ++;
        html += '<div class="spec" id="spec' + specIndex + '">';
        if(isFailed(spec)) { 
            failIndex++;
            html += '<h2 id="fail' + failIndex + '" class="fail">Fail #' + failIndex + '</h2>' ;
        }
        html += specAsHtml(spec);
            html += '<div class="resume">';
            if (spec.screenshot !== UNDEFINED){
                var lightboxtag = self.lightbox ? 'data-lightbox="screenshots"' : '';
                html += '<a ' + lightboxtag  + ' href="' + self.screenshotsFolder + spec.screenshot + '">';
                html += '<img src="' + self.screenshotsFolder + spec.screenshot + '" width="100" height="100" />';
                html += '</a>';
            }
            html += '<br />';
            var num_tests= spec.failedExpectations.length + spec.passedExpectations.length;
            var percentage = (spec.passedExpectations.length*100)/num_tests;
            html += '<span>Tests passed: ' + parseDecimalRoundAndFixed(percentage,2) + '%</span><br /><progress max="100" value="' + Math.round(percentage) + '"></progress>';
            html += '</div>';
        html += '</div>';
    }
    html += '\n </article>';
    return html;
}
function specAsHtml(spec) {

    var html = '<div class="description">';
    html += '<h3>' + escapeInvalidHtmlChars(spec.description) + ' - ' + elapsed(spec._startTime, spec._endTime) + 's</h3>';

    if (spec.failedExpectations.length > 0 || spec.passedExpectations.length > 0 ){
        html += '<ul>';
        _.each(spec.failedExpectations, function(expectation){
            html += '<li>';
            html += expectation.message + '<span style="padding:0 1em;color:red;">&#10007;</span>';
            html += '</li>';
        });
        if(self.showPassed === true){
            _.each(spec.passedExpectations, function(expectation){
                html += '<li>';
                html += expectation.message + '<span style="padding:0 1em;color:green;">&#10003;</span>';
                html += '</li>';
            });
        }
        html += '</ul></div>';
    }
    else{
        html += '<span style="padding:0 1em;color:orange;">***Skipped***</span>';
        html += '</div>';
    }
    return html;
}

self.writeFile = function(filename, text) {
    var errors = [];
    var path = self.savePath;

    function phantomWrite(path, filename, text) {
        // turn filename into a qualified path
        filename = getQualifiedFilename(path, filename, window.fs_path_separator);
        // write via a method injected by phantomjs-testrunner.js
        __phantom_writeFile(filename, text);
    }

    function nodeWrite(path, filename, text) {
        var fs = require("fs");
        var nodejs_path = require("path");
        require("mkdirp").sync(path); // make sure the path exists
        var filepath = nodejs_path.join(path, filename);
        var htmlfile = fs.openSync(filepath, "w");
        fs.writeSync(htmlfile, text, 0);
        fs.closeSync(htmlfile);
        return;
    }
    // Attempt writing with each possible environment.
    // Track errors in case no write succeeds
    try {
        phantomWrite(path, filename, text);
        return;
    } catch (e) { errors.push('  PhantomJs attempt: ' + e.message); }
    try {
        nodeWrite(path, filename, text);
        return;
    } catch (f) { errors.push('  NodeJS attempt: ' + f.message); }

    // If made it here, no write succeeded.  Let user know.
    log("Warning: writing html report failed for '" + path + "', '" +
        filename + "'. Reasons:\n" +
        errors.join("\n")
    );
};

// To remove complexity and be more DRY about the silly preamble and <testsuites> element
var prefix = '<!DOCTYPE html><html><head lang=en><meta charset=UTF-8><title>Test Report -  ' + getReportDate() + '</title>';
prefix += `<style>
body{font-family:"open_sans",sans-serif}
a:link,a:visited{color:blue}
.fail{color:red}
.pass{color:green}
.suite{width:100%;overflow:auto}
.suite .stats{margin:0;width:90%;padding:0}
.suite .stats li{display:inline;list-style-type:none;padding-right:20px}
.suite h2{margin:0}
.suite header{margin:0;padding:5px 0 5px 5px;background:#003d57;color:white}
.spec{width:100%;overflow:auto;border-bottom:1px solid #e5e5e5}
.spec:hover{background:#e8f3fb}
.spec h3{margin:5px 0}
.spec .description{margin:1% 2%;width:65%;float:left}
.spec .resume{width:29%;margin:1%;float:left;text-align:center}`
prefix += '</style>';
if(self.lightbox){
    prefix+='<link href="../css/lightbox.css" rel="stylesheet">'
}
prefix += '</head>';
prefix += '<body><h1>Test Report -  ' + getReportDate() + '</h1>';
prefix += '<section>';

var lightboxscript = self.lightbox ? '\n<script src="../js/lightbox-plus-jquery.min.js"></script>\n' : '';
var suffix = '\n</section>' + lightboxscript + '</body></html>';

function wrapOutputAndWriteFile(filename, text) {
    if (filename.substr(-5) !== '.html') { filename += '.html'; }

    var summary = '<span style="font-family:monospace">SUMMARY: Executed ' + totalSpecsExecuted + ' specs, ' + totalSpecsFailed + ' failures </span> ';
    summary += '<a href="console.log" target="_blank" title="If configured, view the saved console output log of this test run">View Log</a>' 
   
    if(failedSpecs.length > 0){
        summary+="<pre style='font-family:monospace'>"
        summary+="**************************************************" + "</br>";
        summary+="*                    Failures                    *"+ "</br>";
        summary+="**************************************************"+ "</br>";
        summary+="<ol>";
        var i = 0;
        for(let spec of failedSpecs){ 
            i++;
          summary+= specFailureAsHtml(spec, i);
        }
        summary+="</ol>";
        summary+="</pre>";

    }
    self.writeFile(filename, (prefix + summary + text + suffix));
}

    function specFailureAsHtml(spec, index) {

        var html = '<li>';
        html += '<a href="#fail' + index + '">Fail #' + index + ':</a> '
        html += escapeInvalidHtmlChars(spec.fullName) + '</li>';//.fullName appends suite name in addition to .description
        html += '<ul>';
        _.each(spec.failedExpectations, function (expectation) {
            html += '<li>';
            html += expectation.message;
            html += '</li>';
        });
        html += '</ul>';

        return html;
    }

return this;
}

module.exports = Jasmine2HTMLReporter;
