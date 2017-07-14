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
	pattern = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_\/-]+$/;
	if (!(pattern.test(newName))){
		alert("Repo names may only contain alphanumeric symbols, slash, underscore and hyphen");
		$("#edit_filename").val(oldName);
	}
}


function do_push()
{

    if (document.getElementById("commit_msg").value.length == 0){
        var r = alert("Please enter a commit message!");
        return;
    }

    document.getElementById('push_git').value='push_git';

    // Check if 2fa is on
    if ($('#code_2fa').length != 0){
        var code_2fa = $("#code_2fa").val();
        pattern = /^[0-9]+$/;
        if (!(pattern.test(code_2fa))){
            var r = confirm("You should supply a numeric 2 factor authentication code. Try to commit anyway?");
        }
        if (r == false) {
            return;
        }
	}

	document.getElementById('editor_form').submit();
}

function upload()
{
    var r = confirm("Really upload a file? This will overwrite existing data!");
    if (r == true) {
        this.form.submit();
    }
}