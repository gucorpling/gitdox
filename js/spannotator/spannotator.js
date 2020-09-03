let range = (start, stop, step=1) => Array(stop - start).fill(start).map((x, y) => x + y * step) 

// constants configuration
ICON_MAP = {
	'person':['male','blue'], 
	'quantity':['sort-numeric-asc','yellow'], 
	'time':['clock-o','pink'], 
	'abstract':['cloud','cyan'], 
	'object':['cube','green'], 
	'animal':['paw','orange'], 
	'plant':['pagelines','magenta'], 
	'place':['map-marker','red'], 
	'substance':['flask','purple'], 
	'organization':['bank','brown'], 
	'event':['bell','gold']};

global_defaults = {
	"DEFAULT_ENTITY_TYPE": 'abstract',
	"DEFAULT_ICON": 'question',
	"DEFAULT_COLOR": 'gray',
	"DRAG_TOL": 5,
	"DEFAULT_SGML_SPAN_TAG": "entity",
	"DEFAULT_SGML_SPAN_ATTR": "entity",
	"DEFAULT_SGML_SENT_TAG": "s",
	"DEFAULT_SGML_TOK_ATTR": null// use null to read tokens from plain text, not SGML tags
}

for (key in global_defaults){
	if ($('#' + key).val()){
		window[key] = $('#' + key).val();
	} else{
		window[key] = global_defaults[key];
	}
}

entity_icon = '<div id="%ID%" class="entity_type"><i title="%TYPE%" class="fa fa-%FATYPE% entity_icon"></i></div>';
close_icon = '<div id="close%ID%" class="close" onclick="delete_entity('+"'"+'%ID%'+"'"+');"><i title="close" class="fa fa-times-circle"></i></div>';
sentnum = 0;

class Entity{
	constructor(tok_ids,type){
		this.type = type;
		this.start = Math.min(...tok_ids);
		this.end = Math.max(...tok_ids);
		this.toks = tok_ids;
		this.length = this.end-this.start +1;
		this.div_id = this.start.toString() + '-' + this.end.toString();
		
		this.get_text = function (){ 
			var entity_text = [];
			for (i of this.toks){
				entity_text.push(tokens[i].word);
			}
			return entity_text.join(" ");
		}
	}
  }

class Token{
	constructor(tid, word, sent, sentnum, sent_tooltip){
		this.tid = tid;  // Running unique token id (over all sentences in document, 1 based)
		this.word = word;
		this.sent = sent;  // Whether this is a sentence initial token
		this.sentnum = sentnum;  // Number of sentence
		this.sent_tooltip = sent_tooltip;  // Tooltip to display on sentence span, such as a translation
	}
}
// Data model
entities = {};  // Stores all Entity objects for the current document, keys are span like strings, e.g. "3-4" for entity spanning tokens 3-4
toks2entities = {}; // Hash map from 1-based token indices to all Entity objects containing them
tokens = {}; // Stores all Token objects for the current document, keys are strings starting with "1"

// Drop down menu for entity selection
// if the document is clicked somewhere
$(document).bind("mousedown", function (e) {
    // if the clicked element is not the menu
    if (!$(e.target).parents(".custom-menu").length > 0) {
		// check that this isn't the original click event that triggered the menu
		if (!($(e.target).offset().left == $(".custom-menu").offset().left)){
			if (!($(e.target).offset().top == $(".custom-menu").offset().top)){
				$(".custom-menu").hide(100); // hide the menu
			}
		}
    }
	// Stop tracking hover since it slows down selectable lasso box
	$("#editor").unbind("mousemove");
});
// Start tracking hover to highlight annotation span borders for resize, since we are not using selectable lasso box
$(document).bind("mouseup", function () {	$("#editor").bind("mousemove", track_hover);});

// If the menu element is clicked
$(".custom-menu li").click(function(){
    // Hide it AFTER the action was triggered
    $(".custom-menu").hide(100);
});

function drop_response(draggableId,droppableId,ui) {
  
  // diagnose original span and target new boundary token id
  parts = draggableId.split("-")
  dragged_side = drag_border_side;
  orig_start  = parseInt(parts[0]);
  orig_end = parseInt(parts[1]);
  
  if (droppableId.startsWith("t")){    // dragged into a token
	target_tok = parseInt(droppableId.replace("t",""));
	if (dragged_side=="left" && target_tok > 1){ // Snap to beginning of token if dragging left into a token
		target_tok -= 1;
	}
  } else{
	  alert("Invalid drag target!");
	  return false;
  }	

  // Check that all entities overlapping proposed span are either entirely within or around it
  if (target_tok > orig_end){
	  proposed_start = orig_start;
	  proposed_end = target_tok;
  }else if ((target_tok < orig_end  && target_tok >= orig_start) || (target_tok <= orig_end  && target_tok > orig_start)){ // make span smaller
		if (dragged_side == "right"){ // smaller on the right
			proposed_start = orig_start;
			proposed_end = target_tok;
		} else{ // smaller on the left
			proposed_start = target_tok;
			proposed_end = orig_end;
		}
  }else{
	 proposed_start = target_tok;
	 proposed_end = orig_end;
  }
if (dragged_side == "left" && proposed_start > 1){ // Add one for left boundary, since separators have the number of the preceding token
	proposed_start += 1;
	target_tok += 1;
}
  
  if (proposed_start == orig_start && proposed_end == orig_end){ // Check there was an actual resize
	  return false
  }
  
  if (proposed_start.toString() + "-" + proposed_end.toString() in entities){  // Check if this is span identical to another existing span
	return false;
  }

	toks_to_check = range(proposed_start, proposed_end+1);
	for (tok of toks_to_check){
	  if (!(tok in toks2entities)){
		  continue;
	  }
	  ents = toks2entities[tok];
	  if (ents.length==0){
		  continue
	  }
		for (span in ents){
			e = toks2entities[tok][span];
			if (e.start == orig_start && e.end == orig_end){  // this is the original entity itself
				continue;
			}
			if (e.start < proposed_start && e.end < proposed_end){
				alert("invalid");
				return false;
			}
			if (e.start > proposed_start && e.end > proposed_end){
				alert("invalid");
				return false;
			}
		}
	}

	// Check that tokens are in the same sentence
	sequential = check_sequential(toks_to_check);
	if (!sequential){
		return false;
	}

  
  // Valid span, delete old span and create new one
  old_id = orig_start.toString() + "-" + orig_end.toString();
  entity_type = entities[old_id].type
  delete_entity(old_id);
  $(ui.draggable).remove();
  add_entity(toks_to_check);
  change_entity(entity_type);
  
  //alert('detected drag from ' + draggableId + ' to '+droppableId);
  return true;
}

function make_context_menu(){
	$('#anno-context').html('');
	for (anno_val of Object.keys(ICON_MAP).sort()){
		menu_option = '<li onclick="change_entity(' + "'" + anno_val + "'"+');"><i style="color: gray; font-size: small" class="fa fa-'+ICON_MAP[anno_val][0]+'"></i> '+anno_val+'</li>';
		$('#anno-context').append(menu_option);
	}
}


$(document).on("keypress", function (e) {
	key = e.which;
	if (key == 13){ // User hit enter, make a new entity if anything is selected
		if ($('.ui-selected').length > 0){
			add_entity();
			event.preventDefault();
			return false;
		}
	} 
});

$(document).on("keydown", function (e) {
	if (e.ctrlKey){
		if (e.keyCode == 67){ // User hit ctrl+c, copy selected tokens
			if ($('.ui-selected').length > 0){
				e.preventDefault();
				to_copy = [];
				for (token of $('.ui-selected')){
					to_copy.push(token.innerHTML);
				}
				window.prompt("Copy to clipboard: Ctrl+C, Enter", to_copy.join(" "));
			}
		}
	}
});

function drag_stop(ev, ui){
		$("#editor").bind("mousemove", track_hover);
	
	    mouse_x = ui.helper.position().left,
        mouse_y = ui.helper.position().top;
		mouse_x = ev.clientX;
        mouse_y = ev.clientY;

		// get all token coordinates
		toks = Array.from($(".tok"));
		tok_coords = toks.map(tok => {rect = tok.getBoundingClientRect();  return [rect.x, rect.y, rect.width, rect.height];});
		distances = [];
		tok_coords.forEach(tok_coord => {
			distance = Math.hypot(tok_coord[0]-mouse_x, tok_coord[1]-mouse_y);
			if (tok_coord[0] > mouse_x || tok_coord[1] + tok_coord[3] < mouse_y || tok_coord[1] > mouse_y){ // Closest token left is beyond the mouse X or outside mouse Y
				distances.push(100000); // Assign arbitrary large distance to ignore this option
			} else{
				distances.push(parseInt(distance));
			}
		});
		closest_tok_idx = distances.indexOf(Math.min(...distances));
		closest_tok = toks[closest_tok_idx];

        /*$(ui.helper).hide();
        var targetElement = document.elementFromPoint(mouse_x, mouse_y);
        $(ui.helper).show();*/
		
		draggableId = $(this).attr("id");
		droppableId = $(closest_tok).attr("id");
		
		drop_response(draggableId,droppableId,ui);
		$(".custom-menu").hide(100); // Hide context menu in case drag overlapped annotation chooser
}

var drag_border_side;


droppable_settings = {};//stop: drag_stop};
draggable_settings = {
		stop: drag_stop,
		revert: true,
		revertDuration: 0,
		helper: function(){
			return $('<div class="entity" style="border: 3px solid green; width: 0px; height: 14px; position:relative; pointer-events: none"></div>');
		},
		start: function(event, ui){
			$("#editor").unbind("mousemove");

			// Get mouse position relative to entity div left 0
			click_x_inside_entity = event.clientX-$(event.target).offset().left;
			if (click_x_inside_entity<DRAG_TOL){ // Left border drag
				drag_border_side = 'left';
				//console.log(drag_border_side);
			} else if(click_x_inside_entity + DRAG_TOL > $(event.target).width()){ // Right border drag
				drag_border_side = 'right';
				//console.log(drag_border_side);
			} else{return false;}  // Not a border, cancel drag
			
			$(this).draggable('instance').offset.click = {
				left: Math.floor(ui.helper.width() / 2),
				top: Math.floor(ui.helper.height() / 2)
			};
			$(".custom-menu").hide(100); // Hide context menu in case drag overlapped annotation chooser
		}
	};

function accept_drop(elm) {
        // only allow draggables to the placement if there's no other draggable 
        // in the droppable
        if ($(this).hasClass("tok")) {
			//console.log($(this).attr("id"));
			return true;
		}
		else{
			return false;
		}
}

// Border highlighting on hover
var hovered_entity = null;
function unhighlight_entity_border(event){
		if ($(this).hasClass("entity")){
			$(this).removeClass("entity-border-hover-left");
			$(this).removeClass("entity-border-hover-right");
			hovered_entity = null;
		}
}

function set_hovered_entity(event){
	if ($(event.target).hasClass("entity")){
		hovered_entity = $(event.target).attr("id");
	}
}

function track_hover(event){
	if (hovered_entity== null){
		return false;
	}
	if (typeof $("#" + hovered_entity)== "undefined" || typeof $("#" + hovered_entity).offset() == "undefined"){
		hovered_entity = null;
		return false;
	}
	x_inside_entity = event.clientX-$("#" + hovered_entity).offset().left;
	if (x_inside_entity<DRAG_TOL){ // Left border hover
		$("#" + hovered_entity).addClass("entity-border-hover-left");
	} else if(x_inside_entity + DRAG_TOL > $("#" + hovered_entity).width()){ // Right border hover
		$("#" + hovered_entity).addClass("entity-border-hover-right");
	}
	else{ // unhighlight
		$("#" + hovered_entity).removeClass("entity-border-hover-left");
		$("#" + hovered_entity).removeClass("entity-border-hover-right");
	}
}

function bind_entity_events(){
	$(".entity").draggable(draggable_settings);
	$(".entity").hover(set_hovered_entity);
	$(".entity").mouseover(set_hovered_entity);
	$(".entity").mouseleave(unhighlight_entity_border);
}

function bind_tok_events(){
	$(".tok").droppable(droppable_settings);
	$(".tok").click(function(event){
		if (event.ctrlKey){
			$(this).toggleClass("ui-selected");
		} else{
				$(".ui-selected").removeClass("ui-selected");
				$(this).addClass("ui-selected");
		}
	});
}

function init_doc(){
	make_context_menu();
	bind_tok_events();
	bind_entity_events();
	$("#editor").bind("mousemove", track_hover);
	$("#editor, .ui-selectee").bind("click", function (){ 
		// in case spannotator is loaded in an iFrame, make sure it gets focus on click
		container = window.parent.document.getElementById("spannotator_container");
		if (typeof container != "undefined" && container != null){
			container.contentWindow.focus();
		}
	});
	$("#selectable").selectable({filter: '.tok', distance: 10});
}

$(document).ready(function() {
	init_doc();
	container = window.parent.document.getElementById("spannotator_container");
	if ($("#sent_mode",window.parent.document).val() == "sent"){
		toggle_sents();
	}
	
	// Create quick paste dialog
	$(function () {
		$("#import_dialog").dialog({
			autoOpen: false,
			resizable: true,
			width: "350",
			height: 400,
			modal: true,
			buttons: {
				"Close": function () {
					// if textarea is not empty do something with the value and close the modal
					if ($(this).find('textarea').val().length) {
						if ($(this).find('textarea').val().includes("#FORMAT=WebAnno")){
							read_webanno($(this).find('textarea').val());
						} else if ($(this).find('textarea').val().includes("<")){
							read_tt($(this).find('textarea').val());
						}
						$(this).dialog("close");
					}
					$(this).dialog("close");
				}
			}
		});
	});

	// Create export dialog
	$(function () {
		$("#export_dialog").dialog({
			autoOpen: false,
			resizable: true,
			width: "350",
			height: 440,
			modal: true,
			buttons: {
				"Close": function () {
					$(this).dialog("close");
				}
			},
			open: function( event, ui ) {
				run_export('webanno');
			}
		});
	});	
	$("#loading_screen").removeClass("loading");
});

function run_export(format){
	if (format=="webanno"){
		data = write_webanno();
	} else{
		data = write_tt('s');
	}
	$("#export_dialog").find('textarea').val(data);
}

function highlight_drop(ev){
  //$(ev.target).css("border-color", 'blue');
  ev.preventDefault();
}

function unhighlight_drop(ev){
  //$(ev.target).css("border-color", 'transparent');
  ev.preventDefault();
}

function check_sequential(arr){ 
  // Check all tokens are in a contiguous sequence
   arr.sort((a, b) => a - b); 
	prev = arr[0]-1;
    for (i of arr){ 
        if (i != prev+1) {
			alert("Can't add a discontinuous span!");
			$('.ui-selected').removeClass('ui-selected');
            return false; 
		} else{
			prev = i;
		}
	}
	// Check all tokens are in the same sentence
	sent = null;
	prev_sent = null;
	for (i of arr){
		tok = tokens[i];
		if (sent == null) {
			sent = tok.sentnum; 
			prev_sent = tok.sentnum;
		}
		if (tok.sentnum != prev_sent) {
			alert("Can't add a span across sentences!");
			$('.ui-selected').removeClass('ui-selected');
			return false;
		}
	}
	return true;
}

// Creat a new entity
function add_entity(tok_ids, entity_type, batch){
	if (batch === undefined) {batch = false};
	if (entity_type== null){
		entity_type = DEFAULT_ENTITY_TYPE;
	}
	if (tok_ids == null){  // User added entity using UI, read tok_ids from selection
		tok_ids = [];
		$('.ui-selected').each(function() {
			tok_ids.push( parseInt(this.getAttribute("toknum")));
		});
		if (tok_ids.length == 0){
			alert("No words are selected - click some words first");
			return false;
		}
		sequential = check_sequential(tok_ids);
		if (!sequential){
			return false;
		}
	}

	covering = get_maximal_covers(tok_ids);
	new_entity = new Entity(tok_ids, 'abstract');
	snum = tokens[tok_ids[0]].sentnum;
	$('#' + Array.from(covering).join(',#')).wrapAll('<div id="'+new_entity.div_id+'" class="entity s' +sentnum.toString()+ '"> </div>');  
	$('#'+new_entity.div_id).html(entity_icon.replace('%ID%','icon'+new_entity.div_id) +  $('#'+new_entity.div_id).html() + close_icon.replace('%ID%',new_entity.div_id));
	record_entity(new_entity);
	document.getElementById("active_entity").value = new_entity.div_id;
	change_entity(entity_type);
	
	if (!batch){  // if we are adding just a single entity, already call jquery to set the necessary CSS
		set_entity_classes();
	}
	
	return new_entity;
}

function set_entity_classes(){
		// make draggable/set border highlight behavior
		bind_tok_events();
		bind_entity_events();
		$(".ui-selectee").removeClass("ui-selectee");
		$(".tok").droppable(droppable_settings);
		
		// clear selection
		$("#selectable").selectable({filter: '.tok', distance: 10});
		$('#selectable .ui-selected').removeClass('ui-selected');
}

function delete_entity(entity_span){
 // entity_span = document.getElementById("active_entity").value;
  start = entities[entity_span].start;
  entity_length = entities[entity_span].length;
  $('#'+entity_span).children('.entity_type').first().remove();
  $('#'+entity_span).children('.close').first().remove();
    $('#b-left-'+entity_span).remove();
    $('#b-right-'+entity_span).remove();
  child_toks = $('#'+entity_span).children('.tok');
  if (child_toks.length > 0){
	child_toks.first().unwrap();
  }
  else{
    child_divs = $('#'+entity_span).children('.entity');
	  if (child_divs.length > 0){
		child_divs.first().unwrap();
	  }
  }
  delete entities[entity_span];
  indices = Array.from(Array(entity_length).keys());
  for (i of indices){
	entity_count = Object.keys(toks2entities[start+i]).length;
	if (entity_count > 1){
		delete toks2entities[start + i][entity_span];
	}
	else {
		delete toks2entities[start + i];
	}
  }

  $(".custom-menu").hide(100); // hide the menu
}

// Set the entity type for an entity and handle color + icon
function change_entity(entity_type){
  entity_span = document.getElementById("active_entity").value;
  icon = $('#icon' + entity_span);
  html = '<i title="%TYPE%" class="fa fa-%FATYPE% entity_icon"></i>';
  icon_type = DEFAULT_ICON;
  color = DEFAULT_COLOR;
  if (entity_type in ICON_MAP){
	  icon_type = ICON_MAP[entity_type][0];
	  color = ICON_MAP[entity_type][1];
  }
  html = html.replace('%TYPE%',entity_type).replace("%FATYPE%",icon_type);
  icon.html(html);
  entities[entity_span].type = entity_type;
  $('#'+entities[entity_span].div_id).css('border-color',color);
  $(".custom-menu").hide(100); // hide the menu
}

// Insert an entity into the data model
function record_entity(entity){
	entities[entity.div_id] = entity;
	for (rec_tok_id in entity.toks){
		tok = entity.toks[rec_tok_id];
		if (!(tok in toks2entities)){
			toks2entities[tok] = {};
		}
		toks2entities[tok][entity.div_id] = entity;
	}
  }
  
  function get_maximal_covers(tok_ids){
		covering = new Set();
		counter = 0;
		last = false;
		for (tok of tok_ids){
			counter += 1;
			if (tok_ids.length==counter){
				last = true;
			}
			if (tok in toks2entities){
				ents = Object.values(toks2entities[tok]);
				to_remove = new Set();
				for (e of ents){
					for (t of e.toks){
						if (!(tok_ids.includes(t))){
							to_remove.add(e);
						}
					}
				}
				filtered_entities = [];
				for (e of ents){
					if (! to_remove.has(e)){
						filtered_entities.push(e);
					}
				}
				if (filtered_entities.length>0){
					longest = filtered_entities.reduce(function(prev, curr) {
						return prev.length > curr.length ? prev : curr;
					});
					covering.add(longest.div_id);
					covering.add("b-left-"+longest.div_id);
					covering.add("b-right-"+longest.div_id);
				}
				else{
					covering.add('t' + tok.toString());
					if (!(last)){
						//covering.add('sep' + tok.toString());
					}
				}
			}
			else{ // add the token div ID itself
				covering.add('t' + tok.toString());
				if (!(last)){
					//covering.add('sep' + tok.toString());
				}
			}
		}
		return Array.from(covering);
  }
  


$(document).on("mousedown",".entity_type", function () {
   var top = $(this).offset().top; // or var clickedBtnID = this.id
   var left = $(this).offset().left;
			$(".custom-menu").finish().toggle(100).
			// In the right position (the mouse)
			css({
				top: top + "px",
				left: left + "px"
			});
	document.getElementById("active_entity").value=$(this).attr("id").replace("icon","");
});

$(document).on("mousedown",".close", function () {
	document.getElementById("active_entity").value=$(this).attr("id").replace("close","");
	delete_entity($(this).attr("id").replace("close",""));
});


function toggle_sents(){
	$(".sent").toggleClass("break");
	$(".sent").toggleClass("offset");
	$(".sent").toggleClass("numbered");
	if ($(".sent").first().hasClass("numbered")){
		$("#sent_mode",window.parent.document).val("sent");
		$('.sent').each(function(){ 
			$(this)
				.nextUntil(".sent")
				.addBack()
				.wrapAll('<div class="sent_row"/>');
	});}
	else{
		$("#sent_mode",window.parent.document).val("text");
		$('.sent').each(function(){ 
			$(this)
				.nextUntil(".sent")
				.addBack()
				.unwrap();
		});
	}
}

function make_token_div(tok){ // Take a Token object and return HTML representation with sentence break element if needed
	if (tok.sent != null){
		sentnum += 1;
	}
	out_html = '  <div id="t'+tok.tid+'" toknum="'+tok.tid+'" class="tok s'+sentnum.toString()+'">'+tok.word+'</div>\n';//<div id="sep'+tok.tid+'" class="sep"></div>\n';
	if (tok.sent != null){
		title_string = '';
		if (tok.sent_tooltip != ''){
			title_string = 'title="'+tok.sent_tooltip.replace(/"/g,"&quot;")+'" ';
		}
		out_html = '  <span id="s'+sentnum+'" '+title_string+'class="sent s'+sentnum.toString() +'"/>\n' + out_html;
	}
	return out_html
}

/* IMPORT/EXPORT*/


function read_webanno(data){
	$("#selectable").html("");  // Clear editor
	// Clear data model
	entities = {};
	toks2entities = {};
	tokens = {};
	
	lines = data.split("\n");
	sent = 0;
	tid= 0;
	e2tok = {};
	e2type = {};
	for (line of lines){
		if (line.includes("\t")){
			// Read text
			fields = line.split("\t");
			if (fields[0].endsWith("-1")){//new sentence
				sent += 1;
				new_sent = true;
				sent_info = sent;
			}
			else{
				new_sent = false;
				sent_info = null;
			}
			tid += 1;
			tok = new Token(tid.toString(), fields[2],sent_info,sent,'');
			tokens[tid.toString()] = tok;
			$("#selectable").append(make_token_div(tok));
			
			// Read span annotations
			ent_data = fields[3];
			if (ent_data ==  "_"){
				continue;
			}
			ents = ent_data.split("|");
			for (ent of ents){
				if (ent.includes("[")){
					[e_type, e_id] = ent.split("[");
					e_id = e_id.replace("]","");
					if (!(e_id in e2tok)){
						e2tok[e_id] = [tid];
					}
					else{
						e2tok[e_id].push(tid);
					}
					e2type[e_id] = e_type;
				}
				else{ // Single token entity
					add_entity([tid],null,true);
					change_entity(ent);
				}
			}
		}
	}
	for (e_id in e2tok){
		e_type = e2type[e_id];
		tok_span = e2tok[e_id];
		add_entity(tok_span,null,true);
		change_entity(e_type);
	}
	set_entity_classes();
	init_doc();
}

function read_tt(data, config){

	// set tok to an SGML attribute name to use markup instead of TT plain text tokens as words
	default_conf = {"span_tag": DEFAULT_SGML_SPAN_TAG, "span_attr": DEFAULT_SGML_SPAN_ATTR, "sent":DEFAULT_SGML_SENT_TAG, "tok": DEFAULT_SGML_TOK_ATTR};

	if (typeof config == "undefined"){
		config = {};
	}
	for (setting  in default_conf){
		if (!(setting in config)){
			config[setting] = default_conf[setting];
		}
	}
	
	if (config["tok"].toLowerCase()=="none"){config["tok"]=null;}

	$("#selectable").html("");  // Clear editor
	// Clear data model
	entities = {};
	toks2entities = {};
	tokens = {};

	data = data.replace(/%%quot%%/g,'"').replace(/%%lt%%/g,"<").replace(/%%gt%%/g,">").replace(/\\n/g,"\n");
	lines = data.split("\n");
	sent = 0;
	tid= 1;
	e2tok = {};
	e2type = {};
	new_sent = true;
	span_buffer = [];
	sent_tooltip = '';

	tok_array = [];
	for (line of lines){
		
		if (line.startsWith("<") && line.endsWith(">")){ // tag
			if (line.startsWith('<'+config["sent"]+" ") && line.includes("=")){  // sentence opening tag with attribute - use as sentence title tooltip
				find = '="([^"]*)"'; // catch first attribute
				m =  new RegExp(find);
				sent_tooltip = line.match(m)[1];
			}
			if (!(line.startsWith("</"))){ // opening tag
				if (line.startsWith('<'+config["span_tag"])  && line.includes(' ' + config["span_attr"] + '="')){ // only process target tags
					find = ' ' + config["span_attr"] + '="([^"]*)"';
					m =  new RegExp(find);
					span_type = line.match(m)[1];
					span_buffer.push({"start": tid, "type": span_type});
				}
			} else if (line.startsWith('</'+config["span_tag"]+">")) { // closing tag
				queue = span_buffer.pop();
				span_toks = Array.from(range(parseInt(queue["start"]), tid));
				e_id =  queue["start"].toString() + "-" + (tid-1).toString();
				e2tok[e_id] = span_toks;
				e2type[e_id] = queue["type"];
			} else if (line.startsWith('</'+config["sent"]+">")){  // sentence has ended
				sent += 1;
				new_sent = true;
			} 
			if (config["tok"] != null){
				if (line.includes(' ' + config["tok"] + '="')){ // only process target tags
					find = ' ' + config["tok"] + '="([^"]*)"';
					m =  new RegExp(find);
					word = line.match(m)[1];
					tok = new Token(tid.toString(), word,new_sent,sent,sent_tooltip);
					sent_tooltip = "";
					tokens[tid.toString()] = tok;
					//$("#selectable").append(make_token_div(tok));
					tok_array.push(make_token_div(tok));
					tid += 1;
					new_sent = null;
				}
			}
		}	else if (config["tok"] == null) { // not markup, and we are looking for plain tokens
			word = $.trim(line);
			tok = new Token(tid.toString(), word,new_sent,sent,sent_tooltip);
			sent_tooltip = "";
			tokens[tid.toString()] = tok;
			//$("#selectable").append(make_token_div(tok));
			tok_array.push(make_token_div(tok));
			tid += 1;
			new_sent = null;
		}
	}
	
	// Create token divs
	$("#selectable").append(tok_array.join("\n\t\t"));
	
	// Add entities
	for (e_id in e2tok){
		e_type = e2type[e_id];
		tok_span = e2tok[e_id];
		add_entity(tok_span,null,true);
		change_entity(e_type);
	}
	set_entity_classes();
	init_doc();
}

function show_import() {
    $('#import_dialog').find('textarea').val(''); // clear textarea on modal open
    $("#import_dialog").dialog("option", "title", "Loading....").dialog("open");
    $("span.ui-dialog-title").text('Import data');
}

function show_export() {
    $('#export_dialog').find('textarea').val(''); // clear textarea on modal open
    $("#export_dialog").dialog("option", "title", "Loading....").dialog("open");
    $("span.ui-dialog-title").text('Export data');
} 

function write_webanno(){

	output = [];
	buffer = [];
	toknum = 1;
	e_ids = {};
	chars = 0;
	max_ent_id = 1;
	// preamble
	output.push('#FORMAT=WebAnno TSV 3.2\n#T_SP=webanno.custom.Referent|entity\n');
	
	sent = '#Text=';
	for (t in tokens){
		tok = tokens[t];
		if (tok.sent && sent != '#Text='){
			output.push('');
			output.push($.trim(sent));
			output.push(buffer.join("\n"));
			sent = '#Text=';
			buffer = [];
			toknum = 1;
		}
		anno_array = [];
		anno_string = '';
		if (tok.tid in toks2entities){
			overlapped_ents = toks2entities[tok.tid];
			for (span_id in overlapped_ents){
				e = overlapped_ents[span_id];
				if (!(e.div_id in e_ids)){
					e_ids[e.div_id] = max_ent_id;
					max_ent_id +=1;
				}
				anno_string += e.type;
				if (e.length > 1 || true){ // Remove true to reproduce older WebAnno behavior with no ID for single token spans
					anno_string += "[" + e_ids[e.div_id] + "]";
				}
				anno_array.push(anno_string);
				anno_string = '';
			}
			anno_string = anno_array.join("|");
		}
		if (anno_string==''){
			anno_string = '_';
		}
		line = [tok.sentnum.toString() + "-" + toknum.toString() + "\t" + chars.toString() + "-" + 
					(chars+ tok.word.length).toString()+"\t" + tok.word + "\t" +
					anno_string + "\t"];
		buffer.push(line);
		sent += tok.word + " ";
		chars += tok.word.length + 1;
		toknum+=1;
		
	}
	output.push('');
	output.push($.trim(sent));
	output.push(buffer.join("\n"));
	return output.join("\n");
}

function write_tt(sent_tag){

	output = [];
	buffer = [];
	open_spans = [];
	prev_sent = 0;
	first_sent = true;
	sent = '#Text=';
	for (t in tokens){
		tok = tokens[t];
		
		// close all needed spans
		if (tok.tid in toks2entities){
			overlapped_ents = toks2entities[tok.tid];
		} else{
			overlapped_ents = [];
		}
		to_close = []
		keys = Array.from(open_spans);
		for (span_id of keys){
			if (!(span_id in overlapped_ents)){ // open span no longer extends to this token
				output.push('</entity>');
				var index = open_spans.indexOf(span_id); // remove id from open_spans
				if (index !== -1) open_spans.splice(index, 1);
			}
		}

		// open sent if needed 
		if (tok.sent){
			if (!(first_sent)){
				output.push("</"+sent_tag+">")
			}
			output.push("<"+sent_tag+">")
			first_sent = false;
		}

		// open all needed spans
		if (tok.tid in toks2entities){
			overlapped_ents = toks2entities[tok.tid];
			//overlapped_ents = Object.values(overlapped_ents).sort((a, b) => a.length < b.length);
			sorted_ids = Object.keys(overlapped_ents).sort((a, b) => overlapped_ents[a].length < overlapped_ents[b].length)
			for (span_id of sorted_ids){
				if (open_spans.includes(span_id)){
					continue;
				}
				e = overlapped_ents[span_id];
				open_spans.push(span_id);
				output.push('<entity entity="'+e.type+'">');
			}
		}
		
		// print the token
		output.push(tok.word);
		
	}
	for (span_id of open_spans){
		output.push('</entity>');
	}

	output.push('</' + sent_tag + '>');
	return output.join("\n");
}

function list_entities(pos_list, pos_filter){
	pos_list = pos_list.replace("&quot;",'"').split("|");
	pos_filter = pos_filter.split("|");
	list_groups = {}
	seen = {};
	for (i of range(1,Object.keys(tokens).length+1)){
		pos = pos_list[i-1].replace("&#124;","|");
		if (pos_filter.includes(pos)){ // this is a targeted pos
			if (!(i in toks2entities)){continue;}
			covering = toks2entities[i];
			head = tokens[i].word;
			if (Object.keys(covering).length>0){
				ks = Object.keys(covering).sort(function(a, b) { return covering[a].length - covering[b].length });
				smallest = covering[ks[0]];
				if (!(smallest.type in list_groups)){
					list_groups[smallest.type] = [];
					seen[smallest.type] = [];
				}
				entity_spanned_text = smallest.get_text();
				if (!(seen[smallest.type].includes(entity_spanned_text))){
					list_groups[smallest.type].push(entity_spanned_text+"|||"+head);
					seen[smallest.type].push(entity_spanned_text);
				}
			}
		}
	}
	
	return list_groups;
}