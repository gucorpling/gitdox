myPopup = '';

function openPopup(url) {
    myPopup = window.open(url,'popupWindow','width=640,height=480');
    if (!myPopup.opener)
         myPopup.opener = self;
}

function validate() {
	var docId = $("#id").val();
    $.ajax({
    	url: 'modules/validate_spreadsheet.py',
    	type: 'post',
    	data: {doc_id: docId},
    	dataType: "text",
    	success: function(response) {
       	 $("#validation_report").html(response);
       	},
       	error: function( jqXHR, textStatus, errorThrown) {
       	 alert(errorThrown);
       	}
       	
    });
}