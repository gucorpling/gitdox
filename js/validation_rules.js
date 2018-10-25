$(document).ready(function () {
    $('#xml-table-container').jtable({
        title: 'XML Validation Rules',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'modules/jtable_rule_list.py',
                        type: 'POST',
                        dataType: 'json',
                        data: {domain: "xml"},
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'modules/jtable_create_rule.py',
            updateAction: 'modules/jtable_update_rule.py',
            deleteAction: 'modules/jtable_delete_rule.py'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                title: 'Domain',
                options: ['xml'],
                visibility: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'XSD Schema',
                options: 'modules/jtable_schema_list.py?extension=xsd'
            }
        }
    });
    $('#xml-table-container').jtable('load');
});

$(document).ready(function () {
    $('#meta-table-container').jtable({
        title: 'Metadata Validation Rules',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'modules/jtable_rule_list.py',
                        type: 'POST',
                        dataType: 'json',
                        data: {domain: "meta"},
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'modules/jtable_create_rule.py',
            updateAction: 'modules/jtable_update_rule.py',
            deleteAction: 'modules/jtable_delete_rule.py'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                title: 'Domain',
                options: ['meta'],
                visibility: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'Name'
            },
            operator: {
                title: 'Operator',
                options: ['~', 'exists']
            },
            argument: {
                title: 'Argument'
            }
        }
    });
    $('#meta-table-container').jtable('load');
});

$(document).ready(function () {
    $('#ether-table-container').jtable({
        title: 'EtherCalc Validation Rules',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'modules/jtable_rule_list.py',
                        type: 'POST',
                        dataType: 'json',
                        data: {domain: "ether"},
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'modules/jtable_create_rule.py',
            updateAction: 'modules/jtable_update_rule.py',
            deleteAction: 'modules/jtable_delete_rule.py'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                title: 'Domain',
                options: ['ether'],
                visibility: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'Name'
            },
            operator: {
                title: 'Operator',
                options: ['~', '|', '=', '==', '>', 'exists']
            },
            argument: {
                title: 'Argument'
            }
        }
    });
    $('#ether-table-container').jtable('load');
});

$(document).ready(function () {
    $('#export-table-container').jtable({
        title: 'Export Validation Rules',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'modules/jtable_rule_list.py',
                        type: 'POST',
                        dataType: 'json',
                        data: {domain: "export"},
                        success: function (data) {
                            $dfd.resolve(data);
                        },
                        error: function() {
                            $dfd.reject();
                        }
                    });
                });
            },
            createAction: 'modules/jtable_create_rule.py',
            updateAction: 'modules/jtable_update_rule.py',
            deleteAction: 'modules/jtable_delete_rule.py'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                title: 'Domain',
                options: ['export'],
                visibility: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'Export Spec',
                options: 'modules/jtable_schema_list.py?extension=ini'
            },
            argument: {
                title: 'XSD Schema',
                options: 'modules/jtable_schema_list.py?extension=xsd'
            }
        }
    });
    $('#export-table-container').jtable('load');
});
