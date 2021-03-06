/*
 * Brumba
 *
 * � 2012-2014 Dan Parnete
 * Dual licensed under the MIT and GPL licenses.
*/

var U = require('./client/js/util')
	, MongoClient = require('mongodb').MongoClient
	, GridStore = require('mongodb').GridStore
	, ObjectID = require('mongodb').ObjectID
	
	, dbs = []
	, hex24 = new RegExp( '^[0-9a-fA-F]{24}$' )	// check for hex string of 24 chars
	, mongoURL = 'localhost:27017'


function setURL( url ) {
	mongoURL = url
}

/* Find opened database, or open it
*/
function dbOpen( dbname, callback ) {
	
	if ( !dbname ) {
		console.log('dbOpen:  parameters error:  dbname = ' + dbname + '  collname = ' + collname )
		return
	}
	
	// Look dbs list (opened databases) for this dbname
	for ( var i=0; i < dbs.length; i++ ) {
		if ( dbs[i].databaseName == dbname ) {	// if found return it
			callback(dbs[i])
			return
		}
	}
	
	MongoClient.connect('mongodb://' + mongoURL + '/' + dbname + '?w=1', {native_parser:true}, function(err, db) {
		if ( err ) {
			console.log('err = ' + err)
			console.log('dbOpen: cannot open ' + dbname + ' database')
			callback({err: U.err.db})
		} else {
			dbs.push(db)		// add to dbs list
			callback(db)
		}
	})
}



/* Open collection
	ret = coll, db
*/
function coll( dbname, collname, callback ) {
	if ( dbname && collname ) {
		dbOpen(dbname, function(db) {
			if ( db.err )  callback( db )
			else {
				db.collection(collname, function(err, coll) {
					if ( err ) {
						console.log('err = ' + err)
						console.log('Database ' + dbname + ':  Collection not found: ' + collname)
						callback({err: U.err.coll})
					} else {
						callback(coll, db)
					}
				})
			}
		})
	} else {
		console.log('coll:  parameters error:  dbname = ' + dbname + '  collname = ' + collname )
		callback({err: U.err.param})
	}
}



/* Get

 par = { db, coll, where, fields/concat, sort, skip, limit, result }
 result = 'cursor'/'count'/'code'
*/
function get( par, callback, res ) {
	if ( par && par.db && par.coll ) {
//console.log( par )
//var time = process.hrtime()
		coll(par.db, par.coll, function(coll, db) {
			if ( coll.err )  callback( coll )
			else {
				var where = par.where || {}
					, fields = {}
				if ( par.concat ) fields[par.concat] = 1
				else if ( typeof par.fields == 'string' ) {
					var sp = U.strSplit(par.fields, ',')
					for ( var i=0; i < sp.length; i++ ) fields[sp[i]] = 1
				}
				oid(where)
				if ( par.result == 'count' ) {
					coll.count(where, function(err, count) {
						if ( err ) {
							console.log('Database ' + par.db + ':  Count error on collection: ' + par.coll)
							callback({err: U.err.count})
						} else {
							callback({count: count})
						}
					})
				} else {
					var options = U.objFields(par, 'sort,skip,limit')
					if ( !par.sort )  options.sort = {_id: 1}
					var cur = coll.find( where, fields, options )
					if ( par.result == 'cursor') {
//time = process.hrtime( time )
//console.log( 'cursor time=%ds %dms', time[0], time[1]/1000000 )
						callback( cur )
					} else {
						if ( par.concat ) {
							var data = []
							cur.batchSize = 1
							cur.each( function(err, doc) {
								if ( err ) {
									console.log('Database ' + par.db + ':  concat error on collection: ' + par.coll )
									cur.close()
									callback({err: U.err.data})
								} else if ( doc == null ) {
									callback( data )
								} else if ( doc[par.concat] ) {
									data = data.concat(doc[par.concat])
								}
							})
						} else {
							cur.toArray( function(err, docs) {
								if ( err ) {
									console.log('Database ' + par.db + ':  toArray error on collection: ' + par.coll )
									callback({err: U.err.data})
								} else if ( par.result == 'code') {		// for client scripts
									if ( docs[0] && docs[0].code ) {
										var head = {'Content-Type': 'application/javascript'}
										callback({head: head, data: docs[0].code})
									} else callback({err: U.err.script})
								} else {
//time = process.hrtime( time )
//console.log( 'get recs=%d   time=%ds %dms   db=%s  coll=%s  where=%s', docs.length, time[0], time[1]/1000000, par.db, par.coll, JSON.stringify(where) )
//console.log( 'get recs=%d   db=%s  coll=%s  where=%s', docs.length, par.db, par.coll, JSON.stringify(where) )
									callback(docs)
								}
							})
						}
					}
				}
			}
		})
	} else {
		console.log('get: Wrong parameters: ' + JSON.stringify(par))
	}
}



/* Cursor
*/
function cursor( par, callback ) {
	par.result = 'cursor'
	get(par, callback)
}



/* Post - insert documents to database
 par = { db, coll }
*/
function post( par, data, callback ) {
	if ( !par.db || !par.coll || !data )  return callback({err: U.err.param})
	
	var dat = ( Buffer.isBuffer(data[0]) ) ? JSON.parse(Buffer.concat(data)) : 
						(U.objValid(data)) ? data : data.join('')
	if ( dat.length == 0 )  return callback({err: U.err.data})
	
	coll( par.db, par.coll, function(coll) {
		if ( coll.err )  callback( coll )
		else {
//console.log( dat )
			if ( Array.isArray(dat) ) {
				var len = dat.length
					, ret = []
				next( 0 )
					
				function next( i ) {
					save( dat[i], function(res) {
						if ( res.err )  callback(res)
						else {
							ret.push(res)
							if ( ++i < len )  next( i )
							else  callback(ret)
						}
					})
				}

			} else {
				save( dat, function(res) {
					callback(res)
				})
			}

			
			function save( rec, callback ) {
				var ret = {}
				if ( rec._idx >= 0 ) {		// record index assigned by the client data model 
					ret._idx = rec._idx
					delete rec._idx
				}
				oid(rec)
				
				// Update
				if ( rec._id && !par.insert ) {
					var cond = { _id : rec._id }
					coll.count(cond, function(err, count) {	// check if exists
						if ( !err && count == 1 ) {
							ret._id = rec._id
							arrayFields( rec, cond )
							delete rec._id
							if ( !U.isEmpty(rec) ) {
//console.log( 'update' )
//console.log( rec )
								coll.update( cond, $set(rec), function(err, res) {
									if ( err || res != 1  ) {
										console.log('Database ' + par.db + ':  Collection ' + par.coll + ':  update error: ' + err )
										console.log(rec)
										callback( {err: U.err.upd} )
									} else  callback( ret )
								})
							} else  callback( ret )
						} else {																		// force insert
							par.insert = true
							save(rec, callback)
						}
					})
					
				// Insert
				} else {
//console.log( 'insert' )
					for ( var f in rec ) {
						if ( Array.isArray(rec[f]) ) {
							var ar = rec[f]
							for ( var i=0; i < ar.length; i++ ) {
								var rc = ar[i]
								rc._id = new ObjectID()
								delete rc._idx
							}
						}
					}
					coll.insert(rec, function(err, res) {
//console.log( res )
						if ( err ) {
							console.log('Database ' + par.db + ':  Collection ' + par.coll + ':  insert error: ' + err )
							console.log(rec)
							callback({err: U.err.ins})
						} else {
							ret._id = res[0]._id
							callback( ret )
						}
					})
				}
			}
				
			function arrayFields( rec, cond ) {
//console.log( 'arrayFields' )
//console.log( rec )
				for ( var f in rec ) {
					if ( Array.isArray(rec[f]) ) {
						var ar = rec[f]
						for ( var i=0; i < ar.length; i++ ) {
							var set = {}, rc = ar[i]
//if ( !rc._idx ) {console.log('POST.arrayFields: no _idx on record?'); console.log(rc)}
							oid(rc)
							if ( rc._id )  {					// update
								var cnd = {}
								cnd[f+'._id'] = rc._id
								arrayFields( rc, cnd)
								if ( rc._idx >= 0 ) {
									delete rc._idx
									delete rc._id
									for ( var p in rc )  set[f+'.$.'+p] = rc[p]
									coll.update(cnd, $set(set), function(err, res) {
									})
								}
							} else {								// insert
								rc._id = new ObjectID()
								delete rc._idx
								var s = ''
								for ( s in cond )  {}
								if ( s.indexOf('._id') > 0 )  s = s.replace( '_id', '$.' )
								else  s = ''
								set[s+f] = rc
//console.log( 'arrayFields: insert' )
//console.log( cond )
//console.log( set )
								coll.update(cond, {$push:set}, function(err, res) {
								})
							}
						}
//console.log( 'arrayFields: delete field' )
						delete rec[f]
					}
				}
			}
			
			function $set( rec ) {
				var uns = {}
				for ( var k in rec ) {
					if ( rec[k] == null ) {
						uns[k] = ''
						delete rec[k]
					}
				}
				var set = {$set:rec}
				if ( uns != {} ) set.$unset = uns
				return set
			}
		}
	})
}



/* Delete
 par = { db, coll, where }
*/
function del( par, callback ) {
	if ( par && par.db && par.coll && par.where ) {
		coll( par.db, par.coll, function(coll, db) {
			if ( coll.err )  callback( coll )
			else {
				var where = U.cloneJSON(par.where)
				oid(where)
				if ( par.field ) {
					// Delete embeded array element
					var s = par.field + '._id'
						, cnd = { }, pull = {}
						, sp = par.field.split( '.' )
					cnd[s] = where._id
					s = ''
					for ( var i=0; i < sp.length; i++ ) {
						if ( i > 0 )  s += '.$.'
						s += sp[i]
					}
					pull[s] = {_id : where._id}
					coll.update(cnd, {$pull:pull}, function(err, res) {
						if ( err )  callback({err: U.err.del})
						else  callback({err:0})
					})
					
				} else {
					// Delete record

					var p = U.cloneJSON(par)
					p.db = p.app
					p.coll = 'references'
					delete p.where
					get(p, function(res) {
						if ( res.dbret ) callback(res)
						else {
							var rel = res
							check(rel.length-1)

							function check( i ) {
								if ( i < 0 ) return remove()
								if ( rel[i].toColl != par.coll ) check(i-1)
								else {
									var p = {db: par.db, coll: rel[i].fromColl, where: {$or: []}, result: 'count'}
										, w = {}
									if ( rel[i].fromField.substr(-3) == '_id' )  w[rel[i].fromField] = where._id
									else w[rel[i].fromField] = par.where._id
									p.where.$or.push(w)
									w = {}
									w[rel[i].fromField+'.val'] = where._id
									p.where.$or.push(w)
									get(p, function(res) {
										if ( res.count == 0 ) check(i-1)
										else callback({err: U.err.del, msg: res.count + ' related records found in ' + p.coll})
									})
								} 
							}
						}
					})

					function remove() {
//return callback({err: U.err.del})
						coll.remove( where, {safe: true}, function(err) {
							if ( err )  callback({err: U.err.del})
							else  callback({err:0})
						})
					}
				}
			}
		})
	} else {
		console.log('del: Wrong parameters: ' + JSON.stringify(par) )
	}
}




/* GridStore file read/write

 par = { db, _id, filename, mode, path, filetype, options }
 mode: w/wf/r/rf (write / write file / read / read file
 path: full file path
 options: GridStore options
*/
function file( par, data, callback ) {
	if ( !par.db )  return callback( {err: U.err.param} )
	
	var mode = 'r'
	oid( par )	
	if ( par.mode[0] == 'w' )  mode = 'w'
	
	dbOpen( par.db, function(db) {
		if ( db.err )  return callback( db )
		new GridStore(db, par._id, par.filename, mode, par.options).open( function(err, gs) {
			if ( err ) {
				console.log('Database ' + par.db + ':  Cannot open GridStore for: ' + par.filename )
				console.log(err)
				callback({err: U.err.file})
			
			// Read stream
			} else if ( par.mode == 'r' ) {
				if ( !data ) return callback({err: U.err.param})
				var res = data
				res.writeHead(200, {'Content-Type': gs.contentType})
				var stream = gs.stream(true)
				stream.on('data', function(chunk) {
					res.write(chunk)
				})
				.on('end', function() {
					res.end()
				})
			
			// Write stream
			} else if ( par.mode == 'w' ) {
				if ( !data ) return callback({err: U.err.data})
				var len = data.length
				write( 0 )

				function write( i ) {
					gs.write( data[i], function(err, gs) {
						if ( err ) {
							console.log('Database ' + par.db + ':  Cannot write file: ' + par.filename )
							callback({err: U.err.file})
						} else if ( i < len-1 ) {
							write( i+1 )
						} else {
							gs.close( function(err, result) {
								callback({newid:result._id})
							})
						}
					})
				}
			
			// Read file
			} else if ( par.mode == 'rf' ) {
				gs.seek(0, function() {
					gs.read( function(err, data) {
						if ( err ) {
							console.log('Database ' + par.db + ':  Cannot read file: ' + par.filename )
							callback({err: U.err.file})
						} else {
							callback(data)
						}
					})
				})
				
			// Write file
			} else if ( par.mode == 'wf') {
				gs.writeFile(par.path, function(err, g) {
					gs.close( function(err, result) {
						if ( err ) {
							console.log('Database ' + par.db + ':  Cannot write file: ' + par.path )
							callback({err: U.err.file})
						} else {
							callback({newid:result._id})
						}
					})
				})

			} else {
				console.log('Database ' + par.db + ':  File ' + par.filename + ':  Mode error, must be w/r/s')
			}
		})
	})
}



/* Convert to ObjectID
*/
function oid( rec ) {
	if ( rec ) {
		for ( var p in rec ) {
			if ( (p.substr(-3) == '_id' && typeof rec[p] == 'string' && hex24.test(rec[p])) ||
					(p.substr(-4) == '.val' && typeof rec[p] == 'string' && hex24.test(rec[p])) )
				rec[p] = new ObjectID(rec[p])
		}
	}	
}



/* Returns one field array
*/
function subQuery( par, callback ) {
	if ( par.field ) {
		var	p = par.field.lastIndexOf('.')
			, f, ar
		if ( p > 0 ) {
			f = par.field.substr(p+1)
			ar = par.field.substr(0, p)
		} else f = par.field
		if ( ar ) par.concat = ar
		get(par, function(res) {
			if ( res.err ) return callback(res)
			var ret = []
			for( var i=0, len=res.length; i < len; i++ ) {
				var r = res[i]
					, v = r[f]
				if ( r[f] ) {
					if ( typeof v == 'string' && hex24.test(v) ) v = new ObjectID(v)
					ret.push(v)
				}
			}
			callback(ret)
		})
	} else callback([])
}




exports.setURL = setURL
exports.dbOpen = dbOpen
exports.coll = coll
exports.cursor = cursor
exports.get = get
exports.post = post
exports.del = del
exports.file = file
exports.ObjectID = ObjectID
exports.subQuery = subQuery
