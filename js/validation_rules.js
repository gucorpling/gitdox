$(document).ready(function () {
    $('#xml-table-container').jtable({
        title: 'XML Validation Rules',
        sorting: true,
        actions: {
            listAction: function (postData, jtParams) {
                jtParams.domain = 'xml';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'validation_rules_service.py?action=list',
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
            createAction: 'validation_rules_service.py?action=create',
            updateAction: 'validation_rules_service.py?action=update',
            deleteAction: 'validation_rules_service.py?action=delete'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                defaultValue: 'xml',
                type: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'XSD Schema',
                options: 'validation_rules_service.py?action=listschemas&extension=xsd'
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
                jtParams.domain = 'meta';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'validation_rules_service.py?action=list',
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
            createAction: 'validation_rules_service.py?action=create',
            updateAction: 'validation_rules_service.py?action=update',
            deleteAction: 'validation_rules_service.py?action=delete'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                defaultValue: 'meta',
                type: 'hidden'
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
                jtParams.domain = 'ether';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'validation_rules_service.py?action=list',
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
            createAction: 'validation_rules_service.py?action=create',
            updateAction: 'validation_rules_service.py?action=update',
            deleteAction: 'validation_rules_service.py?action=delete'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                defaultValue: 'ether',
                type: 'hidden'
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
                options: ['~', '|', '=', '==', '>', 'exists', 'doesntexist']
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
                jtParams.domain = 'export';
                return $.Deferred(function ($dfd) {
                    $.ajax({
                        url: 'validation_rules_service.py?action=list',
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
            createAction: 'validation_rules_service.py?action=create',
            updateAction: 'validation_rules_service.py?action=update',
            deleteAction: 'validation_rules_service.py?action=delete'
        },
        fields: {
            id: {
                title: 'ID',
                key: true,
                visibility:'hidden'
            },
            domain: {
                defaultValue: 'export',
                type: 'hidden'
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            name: {
                title: 'Export Spec',
                options: 'validation_rules_service.py?action=listschemas&extension=ini'
            },
            argument: {
                title: 'XSD Schema',
                options: 'validation_rules_service.py?action=listschemas&extension=xsd'
            }
        }
    });
    $('#export-table-container').jtable('load');
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
