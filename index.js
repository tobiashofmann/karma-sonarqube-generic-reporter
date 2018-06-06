var os = require('os')
var path = require('path')
var fs = require('fs')
var builder = require('xmlbuilder')
var pathIsAbsolute = require('path-is-absolute')

var UnitSonarQubeGenericReporter = function(baseReporterDecorator, config, logger, helper, formatError) {
    
    // variables
    var log = logger.create('reporter.unit-sonarqube-generic');
    var reporterConfig = config.unitSonarqubeGenericReporter || {};
    var outputDir = reporterConfig.outputDir;
    var outputFile = reporterConfig.outputFile;
    var useBrowserName = reporterConfig.useBrowserName;
    var basePath = config.basePath;
    //var nameFormatter = defaultNameFormatter;
    var pendingFileWritings = 0;
    var fileWritingFinished = function() {};
    var allMessages = [];

    // the main object. Will store the test information
    var resultObj = {};

    // set output dir for the report file
    if (outputDir == null) {
        outputDir = '.';
    }
    outputDir = helper.normalizeWinPath(path.resolve(config.basePath, outputDir)) + path.sep;

    if (typeof useBrowserName === 'undefined') {
        useBrowserName = true;
    }

    baseReporterDecorator(this);

    this.adapters = [ function(msg) {
        allMessages.push(msg)
    } ];
    
    var _unitTestName = function (result) {
        return result.suite.join(' ') + ' ' + result.description;
    }


    // Creates the outermost XML element: <testExecutions>
    var initializeXmlForBrowser = function(browser) {
        log.debug("initializeXmlForBrowser");
        // create root node and add attribute
        resultObj.testExecutions = [];
        var att = {
            '@version' : 1
        };
        resultObj.testExecutions.push(att);
    };

    // This function takes care of writing the XML into a file
    var writeXmlForBrowser = function(browser) {
        // Define the file name using rules
        var safeBrowserName = browser.name.replace(/ /g, '_')
        var newOutputFile
        if (outputFile && pathIsAbsolute(outputFile)) {
            newOutputFile = outputFile
        } else if (outputFile != null) {
            var dir = useBrowserName ? path.join(outputDir, safeBrowserName) : outputDir
            newOutputFile = path.join(dir, outputFile)
        } else if (useBrowserName) {
            newOutputFile = path.join(outputDir, 'TESTS-' + safeBrowserName + '.xml')
        } else {
            newOutputFile = path.join(outputDir, 'TESTS.xml')
        }

        // transform JavaScript Object to XML
        var xmlToOutput = builder.create(resultObj, {
            encoding : 'UTF-8'
        })

        if (!xmlToOutput) {
            return;
        }

        // write XML to file
        pendingFileWritings++
        helper.mkdirIfNotExists(path.dirname(newOutputFile), function() {
            fs.writeFile(newOutputFile, xmlToOutput.end({
                pretty : true
            }), function(err) {
                if (err) {
                    log.warn('Cannot write JUnit xml\n\t' + err.message)
                } else {
                    log.debug('JUnit results written to "%s".', newOutputFile)
                }
                if (!--pendingFileWritings) {
                    fileWritingFinished()
                }
            })
        })
    }

    /**
     * Function to be called when the browser is started.
     * This will create the root object for the XML to be written as report when the test run is completed.
     * @parameter {Object} browser Browser object of the current browser
     * @public
     */
    this.onBrowserStart = function(browser) {
        log.debug("this.onBrowserStart");
        initializeXmlForBrowser(browser);
    }

    /**
     * After the browser sessions is ended, write the test results to the report file.
     * @parameter {Object} browser Browser object of the current browser
     * @public
     */
    this.onBrowserComplete = function(browser) {
        log.debug("this.onBrowserComplete");

        var result = browser.lastResult;
        if (!resultObj || !result) {
            return // don't die if browser didn't start
        }
        writeXmlForBrowser(browser);
        // Release memory held by the test suite.
        resultObj = null;
    }

    /**
     * Run has completed for all browsers
     * Resets the allMessages array.
     * @public
     */
    this.onRunComplete = function() {
        log.debug("this.onRunComplete");
        allMessages.length = 0;
    }
    
    /**
     * Create a Object containing the results of the unit test
     * @parameter {@Object} testObj Object to where the current test result is added to.
     * @parameter {@Object} browser
     * @parameter {@Object} result Test result 
     * @private
     */
    var _addTestCaseResult = function(testObj, browser, result) {
        log.debug("_addTestCaseResult");
        
        var validMilliTime = 0;
        if (!result.time || result.time === 0) {
            validMilliTime = 1
        } else {
            validMilliTime = result.time
        }
        
        if (testObj.testCase === undefined) {
            testObj.testCase = [];
        }
        var testCase = {
            '@name' : _unitTestName(result),
            '@duration' : validMilliTime
        };
        
        // todo: delete
        // test start
        for (var key in result) {
            log.warn(key + " : " + result[key]);            
        }
        // test end
        
        // add additional information when test failed or was skipped
        // <skipped message="short message">other</skipped>
        // <error message="short">stacktrace</error>
        if (result["skipped"]) {
            log.warn("test skipped");
            
            testCase.skipped = {
                    '@message': 'Test skipped',
                    '#text': result["log"]
            };
        } else if (!result["success"]) {
            testCase.error = {
                    '@message': 'Test error',
                    '#text': result["log"]
            };
        }
        
        log.warn(testCase);
        testObj.testCase.push(testCase);
    };
    
    /**
     * Construct the file name of the unit test file.
     * Uses the result.suite property to get the name of the unit test as given by the developer in the test.
     * Give by developer in the unit test: test.unit.models.DeviceModel is transformed to the following file: test/unit/models/DeviceModel.js
     * @parameter {Object} result Object containing the test results
     * @return {String} the name of the unit test file, including path. 
     * @private
     */
    var _getTestfileName = function(result) {
        log.debug("_getTestfileName  \n");
        var name = "";
        name += result.suite.join(' ');
        name = basePath + '/' + name.replace(/\./g, '\/') + ".js";
        
        log.debug("_getTestfileName: file name of unit test: " + name);
        return name;
    };
    
    /**
     * Creates the node file in the XML. Needs the path of the unit test file. Added to the XML as file node and path parameter.
     * @parameter {Object} resultObj 
     * @parameter {String} name File location of the unit test file. Added to the XML as attribute path
     * @private
     */
    var _addFileNode = function(resultObj, name) {
        log.debug("_addFileNode  \n");
        
        if (resultObj.testExecutions[0].file === undefined) {
            resultObj.testExecutions[0].file = [];
        }
        if (resultObj.testExecutions[0].file.length === 0) {
            var test = {
                '@path' : name
            };
            resultObj.testExecutions[0].file.push(test);
        }
    };
    
    /**
     * @private
     */
    var _createTestCaseNode = function(file) {
        log.debug("_createTestCaseNode  \n\t");
        if (file.testCase === undefined) {
            file.testCase = [];
        }
    };

    /**
     * 
     */
    this.specSuccess = this.specSkipped = this.specFailure = function(browser, result) {

        log.debug("this.specSuccess = this.specSkipped = this.specFailure  \n");
        
        // get name of test. This is the relative file name
        var name = _getTestfileName(result);

        _addFileNode(resultObj, name);

        var created = false;
        var i = 0;
        for ( var index in resultObj.testExecutions[0].file) {
            log.warn(resultObj.testExecutions[0].file[index]["@path"]);
            if (resultObj.testExecutions[0].file[index]["@path"] === name) {
                created = true;
                i = index;
            }
        }
        
        if (created) {
            log.debug("file node already exists. Add test case to it");
            _createTestCaseNode(resultObj.testExecutions[0].file[i]);
            _addTestCaseResult(resultObj.testExecutions[0].file[i], browser, result);
        } else {
            log.warn("Going to create a new file node for " + name);
            var test = {
                '@path' : name
            };
            resultObj.testExecutions[0].file.push(test);

            i = resultObj.testExecutions[0].file.length - 1;
            log.debug(resultObj.testExecutions[0].file[i]);
            
            _addTestCaseResult(resultObj.testExecutions[0].file[i], browser, result);
        }

    }

    // wait for writing all the xml files, before exiting
    this.onExit = function(done) {
        if (pendingFileWritings) {
            fileWritingFinished = done
        } else {
            done()
        }
    };

}

UnitSonarQubeGenericReporter.$inject = [ 'baseReporterDecorator', 'config', 'logger', 'helper', 'formatError' ]

// PUBLISH DI MODULE
module.exports = {
    'reporter:unitsonarqubegeneric' : [ 'type', UnitSonarQubeGenericReporter ]
}
