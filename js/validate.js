function validate_docname()
{
    var oldName = $("#edit_docname").prop("defaultValue");
	var newName = $("#edit_docname").val();
	pattern = /^[A-Za-z0-9_\.-]+$/;
	if (!(pattern.test(newName))){
		alert("File names may only contain alphanumeric symbols, period, underscore and hyphen");
		$("#edit_docname").val(oldName);
	}
}

function validate_corpusname()
{
    var oldName = $("#edit_corpusname").prop("defaultValue");
	var newName = $("#edit_corpusname").val();
	pattern = /.*/;  //place holder
	if (!(pattern.test(newName))){
		alert("Invalid corpus name");
		$("#edit_corpusname").val(oldName);
	}
}

function validate_repo()
{
    var oldName = $("#edit_filename").prop("defaultValue");
	var newName = $("#edit_filename").val();
	pattern = /^[A-Za-z0-9_\/-]+$/;
	if (!(pattern.test(newName))){
		alert("Repo names may only contain alphanumeric symbols, slash, underscore and hyphen");
		$("#edit_filename").val(oldName);
	}
}

function upload()
{
    var r = confirm("Really upload a file? This will overwrite existing spreadsheet data!");
    if (r == true) {
        this.form.submit();
    }
}