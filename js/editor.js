let range = (start, stop, step=1) => Array(stop - start).fill(start).map((x, y) => x + y * step) 

myPopup = '';

function validate_doc() {
	$("#validate_editor").addClass("disabledbutton");
	$("#validation_report").html("Validating...");
	var docId = $("#id").val();
	var mode = $("#mode").val();
	var schema = $("#schema").val();
    $.ajax({
		url: 'validate.py',
    	type: 'post',
    	data: {doc_id: docId, mode: mode, schema: schema},
    	dataType: "html",
    	success: function(response) {
      	 	$("#validation_report").html(response);
       	 	$("#validate_editor").removeClass("disabledbutton");
       	},
       	error: function( jqXHR, textStatus, errorThrown) {
       	 	alert(errorThrown);
       	 	$("#validation_report").html("");
       	 	$("#validate_editor").removeClass("disabledbutton");
       	}
    });
}

function do_save(){
    if (document.getElementById('code')!=null){
        val = document.getElementById('code').value.replace(/&(?!amp;)/g,'&amp;');
        editor.getDoc().setValue(val);
        document.getElementById('code').value = val;
    }
    document.getElementById('editor_form').submit();
}

function do_save_entities(){
	// Check if entity linking interface is open - if so, save that as well
	if ($("#link_save_button").length){
		do_save_linking();
	}
	
	sent_tag = $('#spannotator_container').contents().find('#DEFAULT_SGML_SENT_TAG').val();
	tt_data = document.getElementById('spannotator_container').contentWindow.write_tt(sent_tag);

	document.getElementById('entity_sgml').value = tt_data;
	document.getElementById('editor_form').submit();
}

function export_ether(){
    doc_id = document.getElementById('doc_id').value;
    stylesheet = document.getElementById('ether_stylesheet').value;

    window.open('export.py?docs=' + doc_id + '&stylesheet=' + stylesheet, '_new');
}

function make_options(optlist){
	let output = [];
	for (opt of optlist){
		output.push('\t\t\t<option value="'+opt+'">');
	}
	return output.join("\n");
}

function highlight_edit(){
	$(this).css('background-color','#f5f8a3');
	$(this).removeAttr('data-guess');
}

function remove_guess(){
	$(this).css("background-color","white");
	$(this).removeData("guess");
	box_id = $(this).attr('id');
	$("#"+box_id.replace(/entref_/,'verify_')).css('display','none');
	$(this).on('input',highlight_edit);
}

function write_guesses(data){
	lookup = {};
	for (entry of data.split("\n")){
		if (entry.includes("+")){
			parts = entry.split("+");
			if (parts[2].length>0){
				lookup[parts[0]+"+"+parts[1]] = parts[2];
			}
		}
	}
	ref_cells = $(".eref");
	$('.verify').css('display','none');  // hide all verification buttons
	ref_cells.each(function(){
			if ($(this).val().length==0 || $(this).data("guess")){  // only guess for empty cells or filled guesses
				let words = $(this).data('text');
				let etype = $(this).data('etype');
				if (words +"+"+etype in lookup){
					this_guess = lookup[words +"+"+etype];
					$(this).val(this_guess);
					$(this).css("background-color","cyan");
					$(this).attr("data-guess","yes");
					box_id = $(this).attr('id');
					$("#"+box_id.replace(/entref_/,'verify_')).css('display','initial');
					$(this).on("input",remove_guess);
				}
			}
		}
	);

}

function do_guess_linking(){
	word_cells = $(".words");
	all_words = word_cells.map(function() {
		return $(this).text();
	});
	all_heads = word_cells.map(function() {
		return $(this).data('head');
	});
	all_types = word_cells.map(function() {
		return $(this).data('etype');
	});
	to_guess = [];
	for (i in range(0,all_words.length)){
		to_guess.push(all_words[i]+"+"+all_heads[i]+"+"+all_types[i]);
	}
	guess_data = to_guess.join("|");
	toggle_nlp_button("#link_guess_button");
	$.ajax({
		url: 'https://corpling.uis.georgetown.edu/gitdox/scriptorium/get_entities.py',
		type: 'POST',
		data: {entries: guess_data, action: 'guess'},
		//async: false,
		success: function (data) {
			write_guesses(data);
			toggle_nlp_button("#link_guess_button");
		},
		error: function(err) {
			alert("NER error");
			console.log(err);
			toggle_nlp_button("#link_guess_button");
		}
	});

}

function verify_guess(box_identifier){
	$("#"+box_identifier).css("background-color","#f5f8a3");
	//$("#"+box_identifier).removeData("guess");
	$("#"+box_identifier).removeAttr("data-guess");
	$("#"+box_identifier.replace(/entref/,'verify')).css("display","none");
	$("#"+box_identifier).on('input',highlight_edit);
}

function do_save_linking(){
	// Collect entity linking information from form
	var payload = [];
	var erefs =[];
	let docId = $("#id").val();
	ref_cells = $(".eref");
	ref_cells.each(function(){
			if (!($(this).data("guess"))){ // do not save unverified guesses
				if ($(this).val().length>0){
					save_entry = $(this).data("text").replace(/[|+]/g,'') + "+" + $(this).data("head").replace(/[|+]/g,'')  + "+" + $(this).data("etype") + "+" + $(this).val().replace(/(^\s+|[|+;]|\s+$)/g,'').replace(/\s+/g,' ');
					payload.push(save_entry);
					erefs.push($(this).data("etype") + "+" + $(this).val().replace(/[|+]/g,''));
				}
			}
	});
	
	// Update browser's store of datalists with added entities
	known_entities = $('#spannotator_container').contents().find('#ALL_ENTITY_LIST').val().split("|")
	for (e of erefs){
		if (!(known_entities.includes(e))){
			known_entities.push(e);
		}
	}
	$('#spannotator_container').contents().find('#ALL_ENTITY_LIST').val(known_entities.join("|"));
	update_entity_datalists();
	
	// Send information to server to save
	let save_data = payload.join("|");
	ecount = $('.eref').length;
	toggle_nlp_button("#link_save_button",'floppy-o');
	$.ajax({
		url: 'https://corpling.uis.georgetown.edu/gitdox/scriptorium/get_entities.py',
		type: 'POST',
		data: {entries: save_data, action: 'save', docid:  docId.toString(), entcount: ecount },
		//async: false,
		success: function (data) {
			toggle_nlp_button("#link_save_button",'floppy-o');
			$(".eref").filter(":not([data-guess])").css('background-color','white');
		},
		error: function(err) {
			alert("Save error");
			console.log(err);
			toggle_nlp_button("#link_save_button",'floppy-o');
		}
	});
}

function report_no_entities(){
	toggle_nlp_button("#no_entities_button",'low-vision');
	let docId = $("#id").val();
	$.ajax({
		url: 'https://corpling.uis.georgetown.edu/gitdox/scriptorium/get_entities.py',
		type: 'POST',
		data: {action: 'empty', docid:  docId.toString(), entcount: 0 },
		//async: false,
		success: function (data) {
			toggle_nlp_button("#no_entities_button",'low-vision');
		},
		error: function(err) {
			alert("Save error");
			console.log(err);
			toggle_nlp_button("#no_entities_button",'low-vision');
		}
	});
}


function update_entity_datalists(){
	entity_options = $('#spannotator_container').contents().find('#ALL_ENTITY_LIST').val();
	all_options = {};
	for (entry of entity_options.split("|")){
		parts = entry.split("+");
		group = parts[0];
		if (!(group in all_options)){all_options[group]= [];}
		all_options[group].push(parts[1]);
	}
	let all_datalists = $("datalist");
	all_datalists.each(function(){
		g = $(this).data("group");
		$(this).html(""); // clear current options
		group_options = "";
		if (g in all_options){
			group_options += make_options(all_options[g]);
		}
		if (!(group_options.includes("(pass)"))){group_options = '\t\t\t<option value="(pass)">\n' + group_options;}
		$(this).append(group_options);	
	});
}

function validate_entityref()
{
    var newName = $(this).val();
	pattern = /^[^;|+]*$/;  //place holder
	if (!(pattern.test(newName))){
		alert("Invalid entity name - names may not contain the characters: ; + |");
		$(this).val(newName.replace(/[|;+]/g,''));
	}
	$(this).val($(this).val().replace(/\s+/g,' ').replace(/(^\s+|\s+$)/g,''));
}

function show_ner(){
	list_groups = 	document.getElementById('spannotator_container').contentWindow.list_entities($("#NER_POS_LIST").val(),$("#NER_POS_FILTER").val());
	entity_links = $('#spannotator_container').contents().find('#DOC_ENTITY_LIST').val();
	entity_lookup = {};
	for (entry of entity_links.split("|")){
		parts = entry.split("+");
		entity_lookup[parts[0] + "+" + parts[1]] = parts[2];
	}
	output = "";
	datalists = "";
	if (Object.keys(list_groups).length>0){
		output = "<h3>Entity types</h3>\n\t<ul>";
		groupnum = 0;
		for (group of Object.keys(list_groups).sort()){
			groupnum+=1;
			output += "\t\t<li>" + group + ':<br><table class="entity_table">\n';
			entnum = 0;
			datalists += '<datalist id="erefs'+groupnum.toString()+'" data-group="'+group+'"></datalist>';
			for (ent_data of list_groups[group]){
				parts = ent_data.split("|||");
				ent_text = parts[0];
				ent_head = parts[1];
				entnum +=1;
				lookup = "";
				if (ent_text+"+"+ group in entity_lookup){lookup = entity_lookup[ent_text+"+"+ group];}
				output += '\t\t\t<tr><td class="words" data-etype="'+group+'" data-head="'+ent_head+'" data-text="'+ent_text+'" id="enttext_'+groupnum.toString()+'_'+entnum.toString()+'">' + ent_text + '</td>';
				output += '<td class="refcell"><input class="eref" id="entref_'+groupnum.toString()+'_'+entnum.toString()+'" data-head="'+ent_head+'" data-text="'+ent_text+'" data-etype="'+group+'" type="text" list="erefs'+groupnum.toString()+'" value="'+lookup+'"></td>';
				output += '<td class="vercell"><div class="verify button" id="verify_'+groupnum.toString()+'_'+entnum.toString()+'" onclick="verify_guess('+"'"+'entref_'+groupnum.toString()+'_'+entnum.toString()+"'"+');"><i class="fa fa-check"> </i></div></td></tr>\n';
			}
			output += "\t\t</table></li>\n";
		}
		output += "\t</ul>\n";
		output += '<div id="link_save_button" class="button h128" onclick="do_save_linking();"><i class="fa fa-floppy-o"> </i> Save entity linking</div>';
		output += '<div id="link_guess_button" class="button h128" onclick="do_guess_linking();"><i class="fa fa-cogs"> </i> Guess identities</div>';
	} else{
		output += '<div id="no_entities_button" class="button h128" onclick="report_no_entities();"><i class="fa fa-low-vision"> </i> Confirm no named entities</div>';
	}
	$("#entity_breakdown").html(datalists + output);
	$("#entity_breakdown").addClass("entity_breakdown");
	update_entity_datalists();
	$('.eref').on('input',highlight_edit);
	$('.eref').on('change',validate_entityref);
}

function toggle_nlp_button(button_id, icon='cogs'){
	$(button_id).toggleClass("disabledbutton");
	$(button_id + " i").toggleClass("fa-" + icon);
	$(button_id + " i").toggleClass("fa-spinner");
	$(button_id + " i").toggleClass("fa-spin");
}

function auto_ner(){
	tt_sgml = document.getElementById('spannotator_container').contentWindow.get_doc_tt();
	tt_sgml = tt_sgml.replace(/%%quot%%/g,'"').replace(/%%lt%%/g,"<").replace(/%%gt%%/g,">").replace(/\\n/g,"\n");
	if (!(tt_sgml.includes('translation='))){
		alert("ERR: Can't find translation spans in source document to detect sentence boundaries!");
		return false;
	}
	toggle_nlp_button("#auto_ner_button");
	$.ajax({
		url: 'https://corpling.uis.georgetown.edu/coptic-nlp/api.py',
		type: 'POST',
		data: {data: tt_sgml, format: 'sgml_entities'},
		//async: false,
		success: function (data) {
			//console.log(data);
			tok_attr = $("#spannotator_container").contents().find("#DEFAULT_SGML_TOK_ATTR").val();
			sent_tag = $("#spannotator_container").contents().find("#DEFAULT_SGML_SENT_TAG").val();
			document.getElementById('spannotator_container').contentWindow.read_tt(data, {"tok": tok_attr,"sent":sent_tag});
			toggle_nlp_button("#auto_ner_button");
		},
		error: function(err) {
			alert("NER error");
			console.log(err);
			toggle_nlp_button("#auto_ner_button");
		}
	});

}

$(document).ready(function () {
    // get id from hidden form element. Watch out, might break in the future
    var docid = $("#id").val();
    $('#metadata-table-container').jtable({
        title: '&nbsp;',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                jtParams.domain = 'meta';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'editor_metadata_service.py?action=list&docid=' + docid,
                        type: 'POST',
                        dataType: 'json',
                        data: jtParams,
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'editor_metadata_service.py?action=create',
            updateAction: 'editor_metadata_service.py?action=update',
            deleteAction: 'editor_metadata_service.py?action=delete&docid=' + docid
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            docid: {
                title: 'Document ID',
                defaultValue: docid,
                type: 'hidden'
            },
            key: {
                title: 'Key',
                sorting: false
            },
            value: {
                title: 'Value',
                sorting: false
            }
        },
        // for autocomplete support https://github.com/volosoft/jtable/issues/115
        formCreated: function(event, formData) {
            $.ajax({
                url: 'editor_metadata_service.py?action=keys',
                type: 'POST',
                dataType: 'json',
                data: {},
                success: function(data) {
                    formData.form.find('[name=key]').autocomplete({
                        source: data['Options']
                    });
                }
            });
        }
    });

    $('#metadata-table-container').jtable('load');
});

$(document).ready(function () {
    // get id from hidden form element. Watch out, might break in the future
    var docid = $("#id").val();
    $('#corpus-metadata-table-container').jtable({
        title: '&nbsp;',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                jtParams.domain = 'meta';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'editor_metadata_service.py?corpus=true&action=list&docid=' + docid,
                        type: 'POST',
                        dataType: 'json',
                        data: jtParams,
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'editor_metadata_service.py?corpus=true&action=create',
            updateAction: 'editor_metadata_service.py?corpus=true&action=update&docid=' + docid,
            deleteAction: 'editor_metadata_service.py?corpus=true&action=delete&docid=' + docid
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            docid: {
                defaultValue: docid,
                type: 'hidden'
            },
            key: {
                title: 'Key',
                sorting: false
            },
            value: {
                title: 'Value',
                sorting: false
            }
        },
        // for autocomplete support https://github.com/volosoft/jtable/issues/115
        formCreated: function(event, formData) {
            $.ajax({
                url: 'editor_metadata_service.py?corpus=true&action=keys',
                type: 'POST',
                dataType: 'json',
                data: {},
                success: function(data) {
                    formData.form.find('[name=key]').autocomplete({
                        source: data['Options']
                    });
                }
            });
        }
    });

    $('#corpus-metadata-table-container').jtable('load');
});


$(document).ready(function(){
    function activateTab(liId, divId) {
        $('ul.tabs li').removeClass('current');
        $('.tab-content').removeClass('current');
        $("#"+liId).addClass('current');
        $("#"+divId).addClass('current');
    }

    var liId = localStorage.getItem(location.pathname + "activeLiId");
    var divId = localStorage.getItem(location.pathname + "activeDivId");
    if (liId && divId) {
        activateTab(liId, divId);
    }

    $('ul.tabs li').click(function() {
        var liId = $(this).attr('id');
        var divId = $(this).attr('data-tab');
        activateTab(liId, divId);
        localStorage.setItem(location.pathname + "activeLiId", liId);
        localStorage.setItem(location.pathname + "activeDivId", divId);
    });
});
