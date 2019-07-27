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

function export_ether(){
    doc_id = document.getElementById('doc_id').value;
    stylesheet = document.getElementById('ether_stylesheet').value;

    window.open('export.py?docs=' + doc_id + '&stylesheet=' + stylesheet, '_new');
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
