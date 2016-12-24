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

