function export_all(){
    stylesheet = document.getElementById('ether_stylesheet').value;
    corpus = document.getElementById('corpus_select').value;
    extension = document.getElementById('extension_select').value;
    status = document.getElementById('status_select').value;
    window.open('export.py?docs=%all%&stylesheet=' + stylesheet + "&corpus=" + corpus + "&extension=" + extension + "&status=" + status, '_new');
}