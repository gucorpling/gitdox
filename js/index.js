function validate_all() {
    $("#validate_landing").addClass("disabledbutton");
    $("#validate_landing").html('<i class="fa fa-spinner fa-spin"></i> validating...');

	var pendingResults = 4;

	// metadata validation call
    $.ajax({
        url: 'validate.py?validation_type=meta',
        type: 'post',
        data: {doc_id: 'all'},
        dataType: "json",
        success: function(response) {
			console.log(response);
            $.each(response, function(docid, v) {
				var color;
				if (v.indexOf("Metadata is valid") > -1) {
					color = 'green';
				}
				else if (v.indexOf("No applicable") > -1) {
					color = 'gray';
				}
				else {
					color = 'red';
				}
				if ( $( "#meta_" + docid ).length ) {
					$("#meta_" + docid)[0].outerHTML = '<div class="tooltip" style="display:inline-block"><i class="fa fa-tags" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
				}
			});
			if (--pendingResults === 0) {
				$("#validate_landing").removeClass("disabledbutton");
				$("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
			}
        }
	});

    $.ajax({
        url: 'validate.py?validation_type=xml',
        type: 'post',
        data: {doc_id: 'all'},
        dataType: "json",
        success: function(response) {
			console.log(response);
            $.each(response, function(docid, v) {
				var color;
				if (v.indexOf("XML is valid") > -1) {
				    color = 'green';
				}
				else if (v.indexOf("No applicable") > -1) {
				    color = 'gray';
				}
				else {
				    color = 'red';
				}
				if ( $("#xml_" + docid).length ) {
					$("#xml_" + docid)[0].outerHTML = '<div class="tooltip" style="display:inline-block"><i class="fa fa-code" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
				}
			});
			if (--pendingResults === 0) {
				$("#validate_landing").removeClass("disabledbutton");
				$("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
			}
        }
	});

    $.ajax({
        url: 'validate.py?validation_type=ether',
        type: 'post',
        data: {doc_id: 'all'},
        dataType: "json",
        success: function(response) {
			console.log(response);
			$.each(response, function(docid, v) {
				var color;
				if (v.indexOf("Spreadsheet is valid") > -1) {
					color = 'green';
				}
				else if (v.indexOf("No applicable") > -1) {
					color = 'gray';
				}
				else {
					color = 'red';
				}
				if ( $( "#ether_" + docid ).length ) {
					$("#ether_" + docid)[0].outerHTML = '<div class="tooltip" style="display:inline-block"><i class="fa fa-table" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
				}
			});
			if (--pendingResults === 0) {
				$("#validate_landing").removeClass("disabledbutton");
				$("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
			}
        }
	});

    $.ajax({
        url: 'validate.py?validation_type=export',
        type: 'post',
        data: {doc_id: 'all'},
        dataType: "json",
        success: function(response) {
			$.each(response, function(docid, v) {
				var color;
				if (v.indexOf("Export is valid") > -1) {
					color = 'green';
				}
				else if (v.indexOf("No applicable") > -1) {
					color = 'gray';
				}
				else {
					color = 'red';
				}
				if ( $( "#export_" + docid ).length ) {
					$("#export_" + docid)[0].outerHTML = '<div class="tooltip" style="display:inline-block"><i class="fa fa-file" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
				}
			});
			if (--pendingResults === 0) {
				$("#validate_landing").removeClass("disabledbutton");
				$("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
			}
		}
	});
}

function filter() {
    var input_id = $("#filter_id").val();
    var input_corpus = $("#filter_corpus").val();
    var input_document = $("#filter_document").val();
    var input_status = $("#filter_status").val();
    var input_assigned = $("#filter_assigned").val();
    var input_mode = $("#filter_mode").val();
    var table = $("#doctable");
    var tr = $("#doctable tbody tr");
    for (i = 0; i < tr.length; i++) {
        td_list = tr[i].getElementsByTagName("td");
        id_td = td_list[0];
        corpus_td = td_list[1];
        document_td = td_list[2];
        status_td = td_list[3];
        assigned_td = td_list[4];
        mode_td = td_list[5];
        if (id_td.innerHTML.indexOf(input_id) > -1
            && corpus_td.innerHTML.indexOf(input_corpus) > -1
            && document_td.innerHTML.indexOf(input_document) > -1
            && status_td.innerHTML.indexOf(input_status) > -1
            && assigned_td.innerHTML.indexOf(input_assigned) > -1
            && mode_td.innerHTML.indexOf(input_mode) > -1
           ) {
            tr[i].style.display = "";
        }
        else {
            tr[i].style.display = "none";
        }
    }
}
