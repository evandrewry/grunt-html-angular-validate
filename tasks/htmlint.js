/*
 * grunt-htmlint
 * https://github.com/nikestep/grunt-htmlint
 *
 * Copyright (c) 2014 Nik Estep
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

    var w3cjs = require('w3cjs');
    var colors = require('colors');
    var tmp = require('temporary');

    // Prototype string with an endsWith function
    String.prototype.endsWith = function(suffix) {
        return this.indexOf(suffix, this.length - suffix.length) !== -1;
    };

    grunt.registerMultiTask('htmlint', 'An HTML5 linter aimed at AngularJS projects.', function() {
        // Merge task-specific and/or target-specific options with these defaults.
        var options = this.options({
            angular: true,
            customtags: [],
            customattrs: [],
            relaxerror: [],
            tmplext: 'tmpl.html',
            doctype: 'HTML5',
            charset: 'utf-8',
            reportpath: 'htmlint-report.json'
        });

        // Add attributes to ignore if this is for AngularJS
        if (options.angular) {
            options.customtags.push('ng-(.*)');
            options.customattrs.push('ng-(.*)');
            options.customattrs.push('on');
        }

        // Delete an exist report if present
        if (options.reportpath !== null && grunt.file.exists(options.reportpath)) {
            grunt.file.delete(options.reportpath);
        }

        // Force task into async mode and grab a handle to the "done" function.
        var done = this.async();

        // Set up the linked list for processing
        var fileCount = 0,
            list = {
                head: null,
                tail: null
            },
            succeedCount = 0,
            reportTime = new Date();

        // Iterate over all specified file groups
        var files = grunt.file.expand(this.filesSrc);
        for (var i = 0; i < files.length; i += 1) {
            if (!grunt.file.exists(files[i])) {
                // Warn that the file cannot be found
                grunt.log.warn('Source file "' + files[i] + '" not found.');
            } else {
                // Detect if template file
                var tmpl = files[i].endsWith(options.tmplext);

                // Add the file to the list
                fileCount += 1;
                if (list.head === null) {
                    list.head = {
                        path: files[i],
                        istmpl: tmpl,
                        next: null
                    };
                    list.tail = list.head;
                }
                else {
                    list.tail.next = {
                        path: files[i],
                        istmpl: tmpl,
                        next: null
                    };
                    list.tail = list.tail.next;
                }
            }
        }

        // Check that we got files
        if (fileCount === 0) { 
            grunt.log.warn('No source files were found');
            done();
            return;
        }

        var checkRelaxed = function(errmsg) {
            for (var i = 0; i < options.relaxerror.length; i += 1) {
                var re = new RegExp(options.relaxerror[i], 'g');
                if (re.test(errmsg)) {
                    return true;
                }
            }
            return false;
        };

        var checkCustomTags = function(errmsg) {
            for (var i = 0; i < options.customtags.length; i += 1) {
                var re = new RegExp('^Element ' +
                                    options.customtags[i] +
                                    ' not allowed as child (.*)');
                if (re.test(errmsg)) {
                    return true;
                }
            }
            return false;
        };

        var checkCustomAttrs = function(errmsg) {
            for (var i = 0; i < options.customattrs.length; i += 1) {
                var re = new RegExp('^Attribute ' +
                                    options.customattrs[i] +
                                    ' not allowed on element (.*) at this point.');
                if (re.test(errmsg)) {
                    return true;
                }
            }
            return false;
        };

        var logErrMsg = function(file, msg) {
            // If we haven't logged this file before, write the starting line,
            // prep the file object is necessary, and mark that we've seen it
            if (file.seenerrs === undefined) {
                file.seenerrs = true;
                file.errs = [];
                grunt.log.writeln('Linting ' +
                                  file.path +
                                  ' ...' +
                                  'ERROR'.red);
            }

            // Log error message to console
            grunt.log.writeln('['.red +
                              'L'.yellow +
                              ('' + msg.lastLine).yellow +
                              ':'.red +
                              'C'.yellow +
                              ('' + msg.lastColumn).yellow +
                              '] '.red +
                              msg.message.yellow);

            // If we are expected to write a report, add to the error array
            if (options.reportpath !== null) {
                file.errs.push({
                    line: msg.lastLine,
                    col: msg.lastColumn,
                    msg: msg.message
                });
            }
        };

        var finished = function() {
            // Output report if necessary
            if (options.reportpath !== null) {
                // Build report
                var report = {
                    datetime: reportTime,
                    fileschecked: fileCount,
                    filessucceeded: succeedCount,
                    failed: []
                };

                var next = list.head;
                while (next !== null) {
                    if (next.errs !== undefined) {
                        report.failed.push({
                            filepath: next.path,
                            numerrs: next.errs.length,
                            errors: next.errs
                        });
                    }
                    next = next.next;
                }

                // Write the report out
                grunt.file.write(options.reportpath, JSON.stringify(report));
            }

            // Finished, let user and grunt know how it went
            if (succeedCount === fileCount) {
                grunt.log.oklns(succeedCount + ' files lint free');
                done();
            }
            else {
                grunt.fail.warn('HTML validation failed');
                done(false);
            }
        };

        var lint = function(file) {
            var errFound = false;

            // Increase the success count if no lint errors were found
            if (!errFound) {
                succeedCount += 1;
            }

            // Move on to next file or finish
            if (file.next === null) {
                finished();
            } else {
                validate(file.next);
            }
        };

        var validate = function(file) {
            var temppath = file.path;

            // If this is a templated file, we need to wrap it as a full
            // document in a temporary file
            if (file.istmpl) {
                // Create a temporary file
                var tfile = new tmp.File();

                // Store temp path as one to pass to validator
                temppath = tfile.path;

                // Build temporary file
                grunt.file.write (temppath,
                                  '<!DOCTYPE html>\n<html>\n<head><title>Dummy</title></head>\n<body>\n' +
                                  grunt.file.read(file.path) +
                                  '\n</body>\n</html>');
            }

            // Do validation
            var results = w3cjs.validate({
                file: temppath,
                output: 'json',
                doctype: options.doctype,
                charset: options.charset,
                callback: function (res) {
                    // Handle results
                    var errFound = false;
                    for (var i = 0; i < res.messages.length; i += 1) {
                        // See if we should skip this error message
                        if (checkRelaxed(res.messages[i].message) ||
                            checkCustomTags(res.messages[i].message) ||
                            checkCustomAttrs(res.messages[i].message)) {
                            // Skip message (it is allowed)
                        } else {
                            // Log the error message
                            errFound = true;
                            logErrMsg(file, res.messages[i]);
                        }
                    }

                    // Clean up temporary file if needed
                    if (file.istmpl) {
                        tfile.unlink();
                    }

                    // If no errors were found, proceed to lint the file
                    // Otherwise, do cleanup and go on to next file
                    if (!errFound) {
                        lint(file);
                    } else {
                        // Move on to next file or finish
                        if (file.next === null) {
                            finished();
                        } else {
                            validate(file.next);
                        }
                    }
                }
            });
        };

        // Start the validation
        validate(list.head);
    });
};