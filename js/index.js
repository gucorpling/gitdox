function validate_all() {
    $("#validate_landing").addClass("disabledbutton");
    $("#validate_landing").html('<i class="fa fa-spinner fa-spin"></i> validating...');
    $.ajax({
        url: 'validate.py',
        type: 'post',
        data: {doc_id: 'all'},
        dataType: "json",
        success: function(response) {
            console.log(response);
            $.each(response, function(key, value) {
                // 1 vs 2 is for ordering ether/xml before metadata, 3 is used for export
                // sort is hidden text at beginning of cell for sorting purposes
                var output1 = '';
                var output2 = '';
                var output3 = '';
                var sort1 = '';
                var sort2 = '';
                var sort3 = '';
                $.each(value, function(k,v) {
                    if (k == "ether") {
                        if (v.indexOf("Spreadsheet is valid") > -1) {
                            color = 'green';
                            sort1 = 'v';
                        }
                        else if (v.indexOf("No applicable") > -1) {
                            color = 'gray';
                            sort1 = 'n';
                        }
                        else {
                            color = 'red';
                            sort1 = 'i';
                        }
                        output1 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-table" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
                    }
                    else if (k == "meta") {
                        if (v.indexOf("Metadata is valid") > -1) {
                            color = 'green';
                            sort2 = 'v';
                        }
                        else if (v.indexOf("No applicable") > -1) {
                            color = 'gray';
                            sort2 = 'n';
                        }
                        else {
                            color = 'red';
                            sort2 = 'i';
                        }
                        output2 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-tags" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
                    }
                    else if (k == "xml") {
                        if (v.indexOf("XML is valid") > -1) {
                            color = 'green';
                            sort1 = 'v';
                        }
                        else if (v.indexOf("No applicable") > -1) {
                            color = 'gray';
                            sort1 = 'n';
                        }
                        else {
                            color = 'red';
                            sort1 = 'i';
                        }
                        output1 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-code" style="color:' + color + '">&nbsp;</i><span class="msg">' + v + '</span></div>';
                    }
                    else if (k == "export") {
                        if (v.indexOf("Export is valid") > -1) {
                            color = 'green';
                            sort3 = 'v';
                        }
                        else if (v.indexOf("No applicable") > -1) {
                            color = 'gray';
                            sort3 = 'n';
                        }
                        else {
                            color = 'red';
                            sort3 = 'i';
                        }
                        output3 += '<div class="tooltip" style="display:inline-block"><i class="fa fa-file" style="color:' + color + '">&nbsp;</i><span>' + v + '</span></div>';
                    }
                });
                if (!output3) {
                    output3 = '<div class="tooltip" style="display:inline-block"><i class="fa fa-file" style="visibility:hidden;">&nbsp;</i><span> </span></div>';
                }
                $("#validate_"+key).before("<i hidden>" + sort1 + sort2 + sort3 + "</i>");
                $("#validate_"+key).html(output1 + output2 + output3);
            });
            $("#validate_landing").removeClass("disabledbutton");
            $("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
        },
        error: function( jqXHR, textStatus, errorThrown) {
            console.log(errorThrown);
            $("#validate_landing").removeClass("disabledbutton");
            $("#validate_landing").html('<i class="fa fa-check"></i> re-validate');
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
