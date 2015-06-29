'use strict';

var exec = require('child_process').exec
    , spawn = require('child_process').spawn
    , exec = require('child_process').exec
    , path = require('path')
    , domain = require('domain')
    , d = domain.create();

/**
 * log
 *
 * Logs a message to the console with a tag.
 *
 * @param message  the message to log
 * @param tag      (optional) the tag to log with.
 */
function log(message, tag) {
    var util = require('util')
        , color = require('cli-color')
        , tags, currentTag;

    tag = tag || 'info';

    tags = {
        error: color.red.bold,
        warn: color.yellow,
        info: color.cyanBright
    };

    currentTag = tags[tag] || function (str) {
        return str;
    };
    util.log((currentTag("[" + tag + "] ") + message).replace(/(\n|\r|\r\n)$/, ''));
}

/**
 * getArchiveName
 *
 * Returns the archive name in database_YYYY_MM_DD.tar.gz format.
 *
 * @param databaseName   The name of the database
 */
function getArchiveName(databaseName) {
    var date = new Date()
        , datestring;

    datestring = [
        databaseName,
        date.getFullYear(),
            date.getMonth() + 1,
        date.getDate(),
        date.getTime()
    ];

    return datestring.join('_') + '.tar.gz';
}

/* removeRF
 *
 * Remove a file or directory. (Recursive, forced)
 *
 * @param target       path to the file or directory
 * @param callback     callback(error)
 */
function removeRF(target, callback) {
    var fs = require('fs');

    callback = callback || function () {
    };

    fs.exists(target, function (exists) {
        if (!exists) {
            return callback(null);
        }
        log("Removing " + target, 'info');
        exec('rm -rf ' + target, callback);
    });
}

/**
 * mongoDump
 *
 * Calls mongodump on a specified database.
 *
 * @param options    MongoDB connection options [host, port, username, password, db]
 * @param directory  Directory to dump the database to
 * @param callback   callback(err)
 */
function mongoDump(options, directory, callback) {
    var mongodump
        , mongoOptions;

    callback = callback || function () {
    };

    mongoOptions = [
        '-h', options.host + ':' + options.port,
    ];

    if (options.db && options.db != 'all') {
        mongoOptions.push('-o');
        mongoOptions.push(options.db);
    } else {
        directory = directory + '/all/';
    }
    mongoOptions.push('-o');
    mongoOptions.push(directory);

    if (options.username && options.password) {
        mongoOptions.push('-u');
        mongoOptions.push(options.username);

        mongoOptions.push('-p');
        mongoOptions.push(options.password);
    }

    log('Starting mongodump of ' + options.db, 'info');
    mongodump = spawn('mongodump', mongoOptions);

    mongodump.stdout.on('data', function (data) {
        log(data);
    });

    mongodump.stderr.on('data', function (data) {
        log(data, 'error');
    });

    mongodump.on('exit', function (code) {
        if (code === 0) {
            log('mongodump executed successfully', 'info');
            callback(null);
        } else {
            callback(new Error("Mongodump exited with code " + code));
        }
    });
}

/**
 * mysqlDump
 *
 * Calls mysqldump on a specified database.
 *
 * @param options    MysqlDB connection options [host, port, username, password, db]
 * @param directory  Directory to dump the database to
 * @param callback   callback(err)
 */
function mysqlDump(options, directory, callback) {
    var fs = require('fs');

    var mysqldump
        , mysqlOptions;

    callback = callback || function () {
    };

    mysqlOptions = ' -h ' + options.host + ' -P ' + options.port;
    mysqlOptions += ' ' + ((options.db && options.db != 'all') ? options.db : '--all-databases');

    if (options.username && options.password) {
        mysqlOptions += ' -u ' + options.username + ' -p ' + options.password;
    }

    log('Starting mysqldump of ' + options.db, 'info');
    if (!fs.existsSync(directory)) {
        require('fs').mkdirSync(directory);
    }

    var cmd = 'mysqldump ' + mysqlOptions + ' > ' + directory + '/' + options.db;
    log(cmd);
    mysqldump = exec(cmd, {});

    mysqldump.stdout.on('data', function (data) {
        log(data);
    });

    mysqldump.stderr.on('data', function (data) {
        log(data, 'error');
    });

    mysqldump.on('exit', function (code) {
        if (code === 0) {
            log('mysqldump executed successfully', 'info');
            callback(null);
        } else {
            callback(new Error("Mysqldump exited with code " + code));
        }
    });
}

/**
 * compressDirectory
 *
 * Compressed the directory so we can upload it to S3.
 *
 * @param directory  current working directory
 * @param input     path to input file or directory
 * @param output     path to output archive
 * @param callback   callback(err)
 */
function compressDirectory(directory, input, output, callback) {
    var tar
        , tarOptions;

    callback = callback || function () {
    };

    tarOptions = [
        '-zcf',
        output,
        input
    ];

    log('Starting compression of ' + input + ' into ' + output, 'info');
    tar = spawn('tar', tarOptions, { cwd: directory });

    tar.stderr.on('data', function (data) {
        log(data, 'error');
    });

    tar.on('exit', function (code) {
        if (code === 0) {
            log('successfully compress directory', 'info');
            callback(null);
        } else {
            callback(new Error("Tar exited with code " + code));
        }
    });
}

/**
 * sendToS3
 *
 * Sends a file or directory to S3.
 *
 * @param options   s3 options [key, secret, bucket]
 * @param directory directory containing file or directory to upload
 * @param target    file or directory to upload
 * @param callback  callback(err)
 */
function sendToS3(options, directory, target, callback) {
    var knox = require('knox')
        , sourceFile = path.join(directory, target)
        , s3client
        , destination = options.destination || '/'
        , headers = {};

    callback = callback || function () {
    };

    // Deleting destination because it's not an explicitly named knox option
    delete options.destination;
    s3client = knox.createClient(options);

    if (options.encrypt)
        headers = {"x-amz-server-side-encryption": "AES256"}

    log('Attemping to upload ' + target + ' to the ' + options.bucket + ' s3 bucket');
    s3client.putFile(sourceFile, path.join(destination, target), headers, function (err, res) {
        if (err) {
            return callback(err);
        }

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            if (res.statusCode !== 200) {
                log(chunk, 'error');
            } else {
                log(chunk);
            }
        });

        res.on('end', function (chunk) {
            if (res.statusCode !== 200) {
                return callback(new Error('Expected a 200 response from S3, got ' + res.statusCode));
            }
            log('Successfully uploaded to s3');
            return callback();
        });
    });
}

/**
 * sync
 *
 * Performs a mongodump on a specified database, gzips the data,
 * and uploads it to s3.
 *
 * @param mongodbConfig   mongodb config [host, port, username, password, db]
 * @param s3Config        s3 config [key, secret, bucket]
 * @param callback        callback(err)
 */
function syncMongo(mongodbConfig, s3Config, callback) {
    mongodbConfig.dbs = mongodbConfig.dbs || ['all'];

    mongodbConfig.dbs.forEach(function (db) {
        var tmpDir = path.join(require('os').tmpDir(), 'mongodb_s3_backup')
            , backupDir = path.join(tmpDir, db)
            , archiveName = getArchiveName(db)
            , async = require('async')
            , tmpDirCleanupFns;

        callback = callback || function () {
        };

        tmpDirCleanupFns = [
            async.apply(removeRF, backupDir),
            async.apply(removeRF, path.join(tmpDir, archiveName))
        ];

        async.series(tmpDirCleanupFns.concat([
            async.apply(mongoDump, {
                host: mongodbConfig.host,
                port: mongodbConfig.port,
                username: mongodbConfig.username,
                password: mongodbConfig.password,
                db: db
            }, tmpDir),
            async.apply(compressDirectory, tmpDir, db, archiveName),
            d.bind(async.apply(sendToS3, s3Config, tmpDir, archiveName)) // this function sometimes throws EPIPE errors
        ]), function (err) {
            if (err) {
                log(err, 'error');
            } else {
                log('Successfully backed up ' + db);
            }
            // cleanup folders
            async.series(tmpDirCleanupFns, function () {
                return callback(err);
            });
        });

        // this cleans up folders in case of EPIPE error from AWS connection
        d.on('error', function (err) {
            d.exit();
            async.series(tmpDirCleanupFns, function () {
                throw(err);
            });
        });
    });
}

/**
 * sync
 *
 * Performs a mysqldump on a specified database, gzips the data,
 * and uploads it to s3.
 *
 * @param mysqlConfig   mysqldb config [host, port, username, password, db]
 * @param s3Config        s3 config [key, secret, bucket]
 * @param callback        callback(err)
 */
function syncMySQL(mysqlConfig, s3Config, callback) {
    mysqlConfig.dbs = mysqlConfig.dbs || ['all'];

    mysqlConfig.dbs.forEach(function (db) {
        if (db.indexOf(';') > -1) {
            return;
        }

        var tmpDir = path.join(require('os').tmpDir(), 'mysql_s3_backup')
            , backupDir = path.join(tmpDir, db)
            , archiveName = getArchiveName(db)
            , async = require('async')
            , tmpDirCleanupFns;

        callback = callback || function () {
        };

        tmpDirCleanupFns = [
            async.apply(removeRF, backupDir),
            async.apply(removeRF, path.join(tmpDir, archiveName))
        ];

        async.series(tmpDirCleanupFns.concat([
            async.apply(mysqlDump, {
                host: mysqlConfig.host,
                port: mysqlConfig.port,
                username: mysqlConfig.username,
                password: mysqlConfig.password,
                db: db
            }, tmpDir),
            async.apply(compressDirectory, tmpDir, db, archiveName),
            d.bind(async.apply(sendToS3, s3Config, tmpDir, archiveName)) // this function sometimes throws EPIPE errors
        ]), function (err) {
            if (err) {
                log(err, 'error');
            } else {
                log('Successfully backed up ' + db);
            }
            // cleanup folders
            async.series(tmpDirCleanupFns, function () {
                return callback(err);
            });
        });

        // this cleans up folders in case of EPIPE error from AWS connection
        d.on('error', function (err) {
            d.exit();
            async.series(tmpDirCleanupFns, function () {
                throw(err);
            });
        });
    });
}

module.exports = { syncMongo: syncMongo, syncMySQL: syncMySQL, log: log };
