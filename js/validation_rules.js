$(document).ready(function () {
    $('#ValidationTableContainer').jtable({
        title: 'Validation Rules',
        sorting: true,
        actions: {
            listAction: 'modules/jtable_rule_list.py',
            createAction: 'modules/jtable_create_rule.py',
            updateAction: 'modules/jtable_update_rule.py',
            deleteAction: 'modules/jtable_delete_rule.py'
        },
        fields: {
            id: {
                title: 'ID',
                key: true
            },
            doc: {
                title: 'Document'
            },
            corpus: {
                title: 'Corpus'
            },
            domain: {
                title: 'Domain',
                options: ['ether', 'meta']
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
    $('#ValidationTableContainer').jtable('load');
});
