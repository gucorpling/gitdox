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
    $.ajax({
    	url: 'modules/validate_spreadsheet.py',
    	type: 'post',
    	data: {doc_id: docId},
    	dataType: "text",
    	success: function(response) {
       	 $("#validation_report").html(response);
       	 $("#validate_editor").removeClass("disabledbutton");
       	},
       	error: function( jqXHR, textStatus, errorThrown) {
       	 alert(errorThrown);
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
    	  console.log(key);
    	  console.log(value);
    	  var output = '';
    	  $.each(value, function(k,v) {
    	   console.log(k);
    	   if (k == "ether"){
    	     if (v == "spreadsheet is valid") {
    	       color = 'green';
    	     }
    	     else {
    	       color = 'red';
    	     }
    	     output += '<div class="tooltip" style="display:inline-block"><i class="fa fa-table" style="color:' + color + '"></i><span>' + v + '</span></div>';
    	    }
    	   else if (k == "meta"){
    	     if (v == "metadata is valid") {
    	       color = 'green';
    	     }
    	     else {
    	       color = 'red';
    	     }
    	     output += '<div class="tooltip" style="display:inline-block"><i class="fa fa-tags" style="color:' + color + '"></i><span>' + v + '</span></div>';
    	    }
    	   });
    	   $("#validate_"+key).html(output);
    	  });
    	 $("#validate_landing").removeClass("disabledbutton");
       	},
       	error: function( jqXHR, textStatus, errorThrown) {
       	 alert(errorThrown);
       	 $("#validate_landing").removeClass("disabledbutton");
       	}

    });
}

function nlp_spreadsheet(){

    var r = confirm("Process XML to make a new spreadsheet? \nThis will overwrite the current spreadsheet");
    if (r == false) {
        return;
    }
    document.getElementById('nlp_spreadsheet').value='do_spreadsheet';
    document.getElementById('editor_form').submit();

}