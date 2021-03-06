/*
 * Brumba
 *
 * � 2012-2014 Dan Parnete
 * Dual licensed under the MIT and GPL licenses.
*/


function extend( obj, props ) {
	for ( p in props )
		if ( props.hasOwnProperty(p) )  obj.prototype[p] = props[p]
}

/*********************************************
 * 				Page object
 *********************************************/
function Page() {
}

Page.prototype = {
	name: null,				// page name
	tag: null,						// html tag
	list: null,						// list
	listCols: null,			// list columns
	recid: null,					// current record id selected from list
	forms: [], 					// forms list
	tabs: [],						// tab list
	srcmode: false,		// search mode
	srcond: null,				// search condition
	seltab: 0,					// selected tab
	insave: false, 			// page in save operation
	prm: null,
	tickers: [],
	

	// Call command
	command : function( cmd, i ) {
		if ( i < this.forms.length &&
					(cmd != 'S' || this.tag.attr('readonly') != 'readonly') ) {
			var self = this
			this.forms[i].command(cmd, function(err) {
				if ( !err )  self.command(cmd, i+1)
				else  self.insave = false
			})
		} else {
			this.insave = false
			if (cmd == 'S' )  this.command('R', 0)
		}
	},
	

	// Find form by name
	findForm : function( name ) {
		for ( var i=0, l=this.forms.length; i < l; i++ )
			if ( this.forms[i].name == name )  return this.forms[i]
		return null
	},
	
	
	// Find form position by obj or by name
	formPos : function( form, name ) {
		for ( var i=0; i < this.forms.length; i++ ) {
			if ( form ) {
				if ( this.forms[i] == form )  return i
			} else {
				if ( this.forms[i].name == name )  return i
			}
		}
		return -1
	},
	
	
	// Retrieve
	retrieve : function() {
		if ( this.list ) this.list.flexReload()
		this.command('R', 0)
	},
	
	
	// Search
	search : function() {
		if ( this.srcmode ) {
			this.srcmode = false
			$('.br-form').css('background', '')
//console.log( this.forms[0].dataset[0] )
			if ( this.forms[0] instanceof Tabular ) {
				this.srcond = this.forms[0].dataset[0]
				if ( this.srcond ) delete this.srcond._idx
				this.forms[0].recs = 0
			} else this.srcond = this.forms[0].modif
			for ( var k in this.srcond ) {
				var val = this.srcond[k]
					, op = ['>=', '>', '<=', '<', '=']
					, i = 0
				while ( i < op.length ) {
					var v = val.substr(0, op[i].length)
					if ( v == op[i] ) {
						this.srcond[k] = { '$gte': parseInt(val.substr(op[i].length), 10) }
						break
					}
					i++
				}
				if ( i == op.length )  this.srcond[k] = { '$regex': val, '$options': 'i' }
			}
			this.retrieve()

		} else {
			this.srcmode = true
			$('.br-form').css('background', '#D55')
			this.command('C', 0)
			if ( this.forms[0] instanceof Tabular ) {
				this.forms[0].dataset = []
				this.forms[0].recs = 1
			}
			if ( this.list ) this.list.flexAddData({})
		}
	},
	
	
	// Delete
	delete : function() {
		if ( this.recid ) {
			var self = this
			deleteDialog( function delFunc() {
				var f = self.forms[0]
				remote(f.querySet('DEL'), function(res) {
					if ( res.err < 0 )  alert('Delete error')
					else {
						self.recid = null
						self.retrieve()
					}
				})
			})
		}
	},
	
	
	newrec : function() {
		this.recid = null
		this.command('C', 0)
		this.command('N', 0)
		var self = this
		onNew(0)

		function onNew( i ) {
			if ( i < self.forms.length ) {
				var err = $(self.forms[i]).triggerHandler('new')
				if ( !err )  onNew(i+1)
			}
		}
	}
}
/*************** END Page object *************/









/*********************************************
 * 				Form object
 *********************************************/
function Form( name, html ) {
	this.name = name			// form name
	this.tag = html				// html tag

	this.master  = null		// master of this form
	this.query  = null		// query 
	this.srcond  = null		// search condition
	this.dataset  = null	// recordset, form's data
	this.rec = null				// active record
	this.modif = null			// modified fields

	this.init()
}

Form.prototype = {
	
	init : function() {
		this.dataset = []
		var s = this.tag.attr('data-query')
		if ( s )  this.query = toJSON(mainArgs(s))
		s = this.tag.data('events')
		if ( s )  eval(s)
	},

	
	// Form commands
	command : function( cmd, callback ) {
		switch ( cmd ) {
			case 'R':	 this.retrieve(callback);	 break
			case 'S':  this.save(callback);  break
			case 'C':  this.clear();  callback();  break
			case 'N':  this.dataset = []  
								if ( this instanceof Tabular ) {
									this.recs = 0
									this.selectRow(0)
									this.disableRows()
								}
								callback()
								break
		}
	},
	

	// Clear
	clear : function() {
		clearFields(this.tag)
		this.modif = null
		this.rec = null
	},
	
	
	// Save record
	save : function( callback ) {
		if ( this.query.coll && this.modif && this.tag.attr('readonly') != 'readonly' ) { 
			if ( !this.modif._id && this.rec && this.rec._id )  this.modif._id = this.rec._id
			if ( $(this).triggerHandler('save') )  return callback(true)
			else {
				var self = this
				remote(this.querySet('POST'), function(res) {
					if ( res.err < 0 )  return callback(res)
					else {
						callback()
						if ( self == page.forms[0] ) {
							if ( !page.recid )  $('#list').flexReload()
							if ( res._id )  page.recid = res._id
							//page.command('R', 0)
						}
					}
				}, this.modif)
			}
		} else callback()
	},
	
	
	// Retrieve
	retrieve : function( callback ) {
		var self = this
		if ( this.query && (this.query.coll || this.query.script ) ) {
			var par = self.querySet('GET')
			if ( page.srcond ) {
				if ( par.where )  $.extend(par.where, page.srcond)
				else  par.where = page.srcond
			}
$(self).triggerHandler('cucu')
console.log('triggerHandler')
			remote(par, function(res) {
				if ( res.err ) return (callback) ? callback(res) : null
				else {
					if ( self instanceof Tabular )  self.res = res
					else  self.dataset = res
					self.dropdown( function() {
						if ( !(self instanceof Tabular) ) {
							if ( $(self).triggerHandler('retrieve') )  self.clear()
							else self.display()
						}
						if ( callback ) callback()
					})
				}
			})
		} else {
			if ( this != page.forms[0] ) {
				if ( page.forms[0] instanceof Tabular ) this.dataset = [page.forms[0].rec]
				else this.dataset = page.forms[0].dataset
			}
			if ( !(this instanceof Tabular) )  this.display()
			if ( callback ) callback()
		}
	},
	
	
	// Retrive autocomplete and select data
	dropdown : function( callback ) {
		var self = this
			, auto = self.tag.find('input[type="autocomplete"]')
			, sel = self.tag.find('select.br-query-args')
			, n = auto.length + sel.length
		if ( n == 0 ) return (callback) ? callback() : null

		// autocomplete
		auto.each( function() {
			var q =  toJSON($(this).attr('data-query'))
				, f = $(this).attr('id')
				, rec = res[0]
			if ( q.extra && rec[f] && rec[f].val ) {			// extra
				var par = {
							cmd: q.cmd || 'GET',
							db: br.db,
							coll: q.coll,
							fields: q.extra,
							where: {_id: rec[f].val}
						}
				remote(par, function(res) {
					if ( !res.err && res.length > 0 ) {
						delete res[0]._id
						self.dataset[0] = objMerge(self.dataset[0], res[0])
					}
					if ( --n == 0 && callback )  callback()
				})
			}
		})
		
		// select
		sel.each( function() {
			Select(this, function(res) {
				if ( --n == 0 && callback )  callback()
			})
		})
	},


	// Display data
	display : function() {
		this.clear()
		if ( this.dataset.length > 0 ) {
			this.rec = this.dataset[0]
			displayForm(this.tag, this.rec)
		}
	},


	// Change event for input fields creates modif object
	setChangeField : function() {
		var self = this
		
		this.tag.find('input,select,textarea').change( function() {
			var fld = $(this)
				, val = fld.val()
			
			if ( fld.is('input:checkbox') ) {		// checkbox
				if ( fld.is(':checked') ) val = true
				else val = false
			}
			else if ( val == '' ) val = null			
			else if ( fld.is('select') ) {
				var op = fld.find('option[value="' + val + '"]')
				if ( op.attr('type') == 'number' ) val = parseInt(val, 10)
			} else if ( fld.is('.br-number') ) {						// number
				val = fld.data('val')
			} else if ( fld.is('input[type*="date"]') ) {		// date
				if ( val != '' ) {
					val = inputDate(val)
					if ( val > 0 ) {
						if ( fld.is('input[type="date"]') ) fld.val(strDate(val))
						else fld.val(strDate(val, true))
					}
				}
			} else if ( fld.is('input[type="autocomplete"]') || fld.is('input[type="filelink"]') 
									|| fld.is('input[type="image"]')	) {		// autocomplete, filelink, image
				if ( val != '' )  val = { txt: val,  val: fld.data('id')	}
			} else if ( fld.is('input[type="password"]') && fld.attr('id') == 'password' ) {
				if ( validPass(val) ) val = sha256_digest(val)
			}
			
			self.modify(this, val)
		})
	},


	// Add value in modif
	modify : function( field, value ) {
		var m = this.master
			, name = $(field).attr('id')
		
		if ( !m.modif )  m.modif = {}					// create modif
		if ( m.rec && m.rec._id )  m.modif._id = m.rec._id			// set _id
		m.modif[name] = value
	},


	// Query string
	querySet : function( cmd, fields, noid ) {
		var q = cloneJSON(this.query) || {}
		if ( cmd == 'POST' )  q.cmd = cmd
		else if ( q.script ) q.cmd = 'SRV'
		else q.cmd = cmd
		q.app = br.app
		if ( !q.db ) q.db = br.db
		
		if ( !fields ) delete q.fields
		
		for ( var k in q.where ) {
			if ( q.where[k] == '$recid' ) {
				q.where[k] = page.recid
				noid = true
			}
		}
		
		if ( !noid && page.recid && (!q.where || !q.where._id) ) {
			if ( !q.where )  q.where = {}
			q.where._id = page.recid
		}
		
		return q
	}
	
}
/*************** END Form object *************/








/*********************************************
 * 				Tabular object
 *********************************************/
function Tabular( name, html ) {
	this.rows = null
	this.row0 = 0
	this.selrow = 0
	this.modified = false
	this.iconDel = null
	this.field = null
	this.scroll = null
	this.scrollval = -1
	this.wheelStep = 0
	this.res = null
	this.recs = 0
	this.noRetrieve = false
	this.canDelete = false

	Form.call(this, name, html)
}

Tabular.prototype = Object.create(Form.prototype)

extend( Tabular, {
	
	init : function() {
		var self = this
			, frm = this.tag
		Form.prototype.init.apply(this)		// call super
		
		// Scrollbar
		this.scroll = $('<div class="br-scrollbar" />').slider({
			orientation: "vertical",
			min : 0,
			max : 0,
			value : 0,
			change : function(ev, ui)  { scrolled(ui.value) },
			slide : function(ev, ui)  { scrolled(ui.value) }
		})
		frm.append(this.scroll)
		
		function scrolled( value ) {
			self.scrollval = value
			setTimeout( function() {
				if ( !self.noRetrieve && self.scrollval > -1 ) { 
					self.row0 = (self.recs > 0) ? self.recs - self.scrollval - 1 : 0
					self.scrollval = -1
					if ( self.query.coll ) {
						var b = self.row0
							, e = b + self.rows.length -1
							, d = self.dataset
						if ( e >= self.recs )  e = self.recs - 1
						if ( !d[b] || !d[e] ) {
							if ( d[b] ) {
								while ( !d[e-1] )  e--
								self.query.skip = e
							} else if ( d[e] ) {
								while ( !d[b] )  b++
								self.query.skip = b - self.query.limit
							} else  self.query.skip = b
							if ( self.query.skip < 0 ) self.query.skip = 0
							self.retrieve()
						} else self.display()
					} else self.display()
				}
			}, 500)
		}
			
		// Mouse wheel
		frm.mousewheel( function(ev, step) {
			self.wheelStep += step
			setTimeout( function() {
				self.scroll.slider('value', self.scroll.slider('value') + self.wheelStep)
				self.wheelStep = 0
			}, 150)
			return false
		})
		
		// Delete icon
		this.iconDel = $('<span class="ui-icon ui-icon-trash" style="position: absolute; left: -10px; top: 2px"></span>').click(function() {
			deleteDialog(function() {
				var q = self.querySet('DEL')
				q.where = { _id : self.rec._id }
				if ( self.query.field ) {
					var mas = self.master
					while ( !mas.query.coll )  mas = mas.master
					q.coll = mas.query.coll
				}
				remote(q, function(res) {
					if ( res.err < 0 )  alert('Delete error')
					else {
						self.dataset.splice(self.selrow + self.row0, 1)
						self.recs--
						self.display()
					}
				})
			})
		})
		
		this.canDelete = !this.tag.attr('readonly') && !this.tag.attr('disabled') 
	},
	
	
	// Add rows
	addRows: function() {
		this.rows = []
		this.rows[0] = this.tag.find('.br-detail')
		this.rows[0].data('row', 0)
		this.rows[0].find('input,select,textarea').each( function() {
			if ( $(this).prop('disabled') ) $(this).attr('br-disabled', 'true')
		})
		var frm = this.tag
			, fh = parseInt(frm.css('height'), 10) - 20
			, hh = parseInt(frm.find('.br-header').css('height'), 10)
			, dh = parseInt(this.rows[0].css('height'), 10)
			, th = parseInt(frm.find('.br-total').css('height'), 10)
		if ( fh <= 100 ) {
			p = frm.parent()
			while ( !p.hasClass('br-tabs') )  p = p.parent()
			if ( p.hasClass('br-tabs') )  fh = p.data('height')
		}
		var n = Math.floor((fh - hh - th) / dh) - 1 
//console.log( '%s    fh=%d  hh=%d  dh=%d  th=%d  n=%d', this.name, fh, hh, dh, th, n )
		for ( var i=1; i <= n; i++ ) {
			this.rows[i] = this.rows[0] .clone()
			$(this.tag).append(this.rows[i])
			this.rows[i].data('row', i)
		}

		// Scrollbar position
		var rm = 0			// rigth margin
		frm.find('.br-field').each( function() {
			var $this = $(this)
				, r = parseInt($this.css('left'), 10) + parseInt($this.css('width'), 10)
			if ( r > rm )  rm = r
		})
		this.scroll.css('left', rm+10).css('top', hh).height(fh-hh-th)

		// Active row
		var self = this
		this.tag.find('input,select,textarea').focus(function() {
			self.selectRow($(this).parent().data('row'))
		})

		this.disableRows()
	},
	
	
	// Clear
	clear : function() {
//console.log( 'clear ' + this.name )
		for ( var i=0; i < this.rows.length; i++ )  clearFields(this.rows[i])
		this.modif = null
		this.rec = null
	},
	
	
	// Select row
	selectRow : function( row ) {
		
		function cascade( form ) {
			for ( var i=page.formPos(form)+1; i < page.forms.length; i++ ) {
				if ( page.forms[i].master == form ) {
					page.forms[i].retrieve( function() {
						cascade(page.forms[i])
					})
				}
			}
		}
		
		for ( var i=0; i < this.rows.length; i++ )
			if ( this.rows[i].hasClass('br-selected-row') )
				this.rows[i].removeClass('br-selected-row' )
		if ( row >= 0 )  this.selrow = row
		this.rows[this.selrow].addClass('br-selected-row')
		if ( this.canDelete ) this.rows[this.selrow].append(this.iconDel)
		if (  this.dataset )  this.rec = this.dataset[this.row0 + this.selrow]
		$(this).triggerHandler('rowselected')
		cascade(this)
	},
	
	
	// Retrieve
	retrieve : function( callback ) {
		if ( !this.query )  return (callback) ? callback() : null
		var self = this
		
		if ( this.query.coll || this.query.script ) {
			// Dataset dimension
			if ( self.recs == 0 ) {
				self.noRetrieve = true
				var par = this.querySet('GET')
				if ( page.srcond ) {
					if ( par.where )  $.extend(par.where, page.srcond)
					else  par.where = page.srcond
				}
				par.result = 'count'
				remote(par, function(res) {
					if ( res.err )  return (callback) ? callback(res) : null
					self.recs = res.count
					self.dataset = new Array(self.recs)
					self.query.skip = 0
					if ( !self.query.limit )  self.query.limit = 50
					self.scrollbar()
					if ( self.recs > 0 ) self.retrieve(callback)
					else {
						self.clear()
						if ( callback ) callback()
					}
				})
			// Retrieve
			} else {
				self.noRetrieve = true
				Form.prototype.retrieve.apply(self, [function(res) {		// call super
					if ( res && res.err ) {
						if ( callback )  callback(res)
						return
					}
					if ( self.res.length > 0 ) {
						// Set data
						for ( var i=self.query.skip, j=0; j < self.res.length; i++, j++)
							self.dataset[i] = self.res[j]
					}
					if ( $(self).triggerHandler('retrieve') )  self.clear()
					else {
						if ( self.query.reorder ) self.reorder()
						self.display()
					}
					self.noRetrieve = false
					if ( callback ) callback()
				}])
			}
		
		} else if ( this.query.field ) {												// field
			if ( this.master.rec && this.master.rec[this.field] )
				this.dataset = this.master.rec[this.field]
			else this.dataset = []
			this.recs = this.dataset.length
			$(this).triggerHandler('retrieve')
			this.dropdown( function() {
				if ( self.query.reorder ) self.reorder()
				self.display()
				self.scrollbar()
				if ( callback )  callback()
			})
		
		} else if ( this.query.concat ) {			// concat
			this.dataset = []
			if ( this.master.rec ) {
				for ( var i=0; i < this.master.recs; i++ ) {
					var rec = this.master.dataset[i]
						, arr = rec[this.field]
					if ( arr ) {
						if ( this.query.add ) {				// add
							var sp = this.query.add.split(/\s*,\s*/)
							for ( var j=arr.length-1; j >= 0; j--) {
								var rc = arr[j]
								for ( var k=0; k < sp.length; k++ )  rc[sp[k]] = rec[sp[k]]
							}
						}
						this.dataset = this.dataset.concat(arr)
					}
				}
			}
			this.recs = this.dataset.length
			if ( self.query.reorder ) self.reorder()
			this.display()
			this.scrollbar()
			if ( callback )  callback()
		}
	},
	
	
	// Set scrollbar
	scrollbar : function() {
		var max = this.recs - 1
		this.scroll.slider('option', {'max': max, 'value': max})
	},

	
	// Display
	display : function() {
//console.log( 'display ' + this.name )
		this.clear()
		for ( var i=this.row0, j=0; i < this.recs && j < this.rows.length; i++, j++ ) {
			displayForm(this.rows[j], this.dataset[i])
		}
		this.disableRows()
		this.selectRow(this.selrow)
	},
	
	
	// Save
	save : function( callback ) {
		if ( this.query.coll ) { 
			var mod = []
			for ( var i=0, len=this.dataset.length; i < len; i++ ) {
				if ( this.dataset[i] && this.dataset[i]._idx >= 0 ) {
					if ( this.query.coll == '_options' ) this.dataset[i].type = br.menuid
					mod.push(this.dataset[i])
				}
			}
			if ( $(this).triggerHandler('save', mod) )  return callback()
			else if ( mod.length > 0 ){
				var self = this
				remote(this.querySet('POST'), function(res) {
					if ( res.err < 0 )  return callback(res)
					else {
						callback()
						self.recs = 0
						page.command('R', page.formPos(self) )
					}
				}, mod)
			} else  callback()
		} else  callback()
	},
	
	
	// Modified field
	modify : function( field, value ) {
		var i = $(field).parent().data('row') + this.row0		// record index in data
			, name = $(field).attr('id')
			 
		// data
		if ( !this.dataset[i] ) {
			this.dataset[i] = {_idx : i}
			this.recs = this.dataset.length
			this.disableRows()
		}
		var r = this.dataset[i]
		if ( !r._idx )  r._idx = i			// _idx is the row number, and marks a modified row
		r[name] = value

		// master
		checkMaster(this, r)
		
		function checkMaster( form, rec ) {
			if ( form.query && form.query.field ) {
				if ( form.master instanceof Tabular ) {
					if ( !form.master.rec._idx )  form.master.rec._idx = form.master.selrow + form.master.row0
					addToMaster(form, form.master.rec, rec)
					checkMaster(form.master, form.master.rec)
				} else {
					if ( !form.master.modif )  form.master.modif = {}
					if ( form.master.rec )  form.master.modif._id = form.master.rec._id
					addToMaster(form, form.master.modif, rec)
				}
			}
		}
		
		function addToMaster( form, modif, rec ) {
			if ( !modif[form.field] )  modif[form.field] = []
			var fld = modif[form.field]
				, j = 0
			while ( j < fld.length && fld[j]._idx != rec._idx && (!objHasFields(rec, '_id') || fld[j]._id != rec._id) )  j++
			fld[j] = rec
		} 
	},
	
	
	// Disable empty rows
	disableRows : function() {
		var n = this.recs - this.row0 + 1
		for ( var i=0; i < this.rows.length; i++ ) {
			var r = this.rows[i]
			if ( i < n ) {
				if ( r.data('disabled') ) {
					r.find('input,select,textarea').each( function() {
						if ( !$(this).attr('br-disabled')) $(this).removeProp('disabled')
					})
					if ( !$(this).prop('disabled') && !$(this).prop('readonly') ) {
						r.find('input[type*="date"]').each( function() {
							if ( !$(this).prop('disabled') && !$(this).prop('readonly') ) addDatepicker($(this))
						})
					}
					r.data('disabled', false)
				}
			} else {
				if ( !r.data('disabled') ) {
					r.find('input,select,textarea').prop('disabled', true)
					r.find('.ui-icon').remove()
					r.data('disabled', true)
				}
			}
		}
	},
	
	
	// Reorder dataset
	reorder : function() {
		var ord = []
		for ( var k in this.query.reorder ) {
			var o = {field: k, ord: this.query.reorder[k]}
				, f = this.rows[0].find('select#'+k)
			if ( f[0] ) o.select = f
			ord.push(o)
		}
		var self = this
		this.dataset.sort( function(a, b) {
			for ( var i=0; i < ord.length; i++ ) {
				var f = ord[i].field
					, va = a[f]
					, vb = b[f]
				if ( ord[i].select ) {
					va = ord[i].select.find('option[value='+va+']').text()
					vb = ord[i].select.find('option[value='+vb+']').text()
				}
				if ( va > vb ) return 1 * ord[i].ord
				else if ( va < vb ) return -1 * ord[i].ord
			}
			return 0
		})
	}
	
})
/*************** END Tabular object *************/









/*********************************************
 * 				Autocomplete
 *********************************************/
function Autocomplete( input ) {
	var query = input.attr("data-query")
	if ( query ) {
		var q = toJSON(query)
			, fld = q.fields
			, p = fld.indexOf(',')
			
		if ( p > 0 )  fld = fld.substring(0, p)
		q.fields = {}
		q.fields[fld] = 1
		q.cmd = 'GET'
		q.db = br.db
		if ( !q.where )  q.where = {}
		
		input.autocomplete({
			source : function( request, response ) {
				q.where[fld] = { '$regex' : '^' + request.term, '$options' : 'i' }
				remote(q, function(res) {
					if ( !res.err ) {
						response($.map(res, function(item) {
							return {
								id: item._id,
								label: item[fld]
							}
						}))
					}
				})
			},
			minLength : 1,
			delay : 0,
			select : function( ev, ui ) {
				input.data("id", ui.item.id)
				input.val(ui.item.label)
			},
			response : function( ev, ui ) {
				if ( ui.content.length == 0 ) {
					alert('Not found: ' + input.val())
					input.val('')
				}
			}
		})
	}
}
/*************** END Autocomplete *************/








/*********************************************
 * 				Select
 *********************************************/
function Select( select, callback ) {
	var $select = $(select)
		, query = $select.attr('data-query')
		, fields = $select.attr('data-fields')
	if ( query ) {
		var q = toJSON(query)
		if ( !q ) return callback()
		if ( Array.isArray(q) ) {			// array of data
			$select.append('<option value=""></option>')
			for ( var i=0, len=q.length; i < len; i++ ) {
				var s = q[i].txt || q[i].val
				$select.append('<option value="' + q[i].val + '">'+ s + '</option>')
			}
			callback()
		} else if ( fields ) {
			$select.empty()
			if ( !q.cmd )  q.cmd = 'GET'
			q.db = br.db
			q.app = br.app
			if ( $select.hasClass('br-query-args') ) substArgs(q.where)
			remote(q, function(res) {
				if ( res.err )  return callback()
				var fld = strSplit(fields, ',')
					, txt = ''
				$select.data('dataset', res)
				$select.append('<option></option>')
				for ( var i=0, len=res.length; i < len; i++ ) {
					var r = res[i]
					txt = ''
					for ( var j=1; j < fld.length; j++ ) {
						var fl = fld[j]
							, sep = ''
						if ( j > 1 ) { 
							if ( fld[j].charAt(0) == '+' ) {
								fl = fld[j].substr(1)
								sep = ' '
							} else {
								sep = ' - '
							} 
						}
						if ( r[fl] ) {
							txt += sep
							txt += r[fl]
						}
					}
					var val = r[fld[0]]
						, typ = (typeof val == 'number') ? 'type="number" ' : ''
					$select.append('<option ' + typ + 'value="' + val + '">'+ txt + '</option>')
				}
				callback()
			})
		} else if (  q.cmd == 'SRV' ) {		// olready formated from server script 
			q.db = br.db
			q.app = br.app
			remote(q, function(res) {
				if ( res.err )  return
				$select.append(res.html)
				callback()
			})
		} else callback()
	} else callback()
}
/*************** END Select *************/







