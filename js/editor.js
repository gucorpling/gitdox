myPopup = '';

function openPopup(url) {
    myPopup = window.open(url,'popupWindow','width=640,height=480');
    if (!myPopup.opener)
         myPopup.opener = self;
}

function validate_doc() {
	$("#validate_editor").addClass("disabledbutton");
	$("#validation_report").html("Validating...");
	var docId = $("#id").val();
	var mode = $("#mode").val();
	var schema = $("#schema").val();
    $.ajax({
		url: 'modules/validate_spreadsheet.py',
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

function validate_all() {
	$("#validate_landing").addClass("disabledbutton");
    $.ajax({
    	url: 'modules/validate_spreadsheet.py',
    	type: 'post',
    	data: {doc_id: 'all'},
    	dataType: "json",
    	success: function(response) {
    	 console.log(response);
    	 $.each(response, function(key, value) {
    	  var output1 = '';
    	  var output2 = '';
    	  $.each(value, function(k,v) {
    	   if (k == "ether"){
    	     if (v == "spreadsheet is valid") {
    	       color = 'green';
    	     }
    	     else {
    	       color = 'red';
    	     }
    	     output1 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-table" style="color:' + color + '">&nbsp;</i><span>' + v + '</span></div>';
    	    }
    	   else if (k == "meta"){
    	     if (v == "metadata is valid") {
    	       color = 'green';
    	     }
    	     else {
    	       color = 'red';
    	     }
    	     output2 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-tags" style="color:' + color + '">&nbsp;</i><span>' + v + '</span></div>';
    	    }
    	    else if (k == "xml"){
    	     console.log(v);
    	     console.log(v.endsWith(" <br/>"));
    	     if (v.endsWith(" validates<br/>")) {
    	       color = 'green';
    	     }
    	     else if (v == "No schema<br/>"){
    	       color = 'gray';
    	     }
    	     else {
    	       color = 'red';
    	     }
    	     output1 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-code" style="color:' + color + '">&nbsp;</i><span>' + v + '</span></div>';
    	    }
    	   });
    	   $("#validate_"+key).html(output1 + output2);
    	  });
    	 $("#validate_landing").removeClass("disabledbutton");
       	},
       	error: function( jqXHR, textStatus, errorThrown) {
       	 alert(errorThrown);
       	 $("#validate_landing").removeClass("disabledbutton");
       	}

    });
}