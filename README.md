# gitdox
Repository for GitDOX, a GitHub Data-storage Online XML editor

This tool is being used by Coptic SCRIPTORIUM as an xml editor/transcription tool for coptic texts. The editor is based on CodeMirror(https://codemirror.net) and uses GitHub as a remote backend, and SQLite for local storage. 

To configure on server or localhost, simply download the files, and make sure

(1) you have added handlers for python for the directory in the main Apache config file, like:

<code>
\<Directory "/Applications/MAMP/htdocs/gitdox"\>
    
    Options +ExecCGI
    
    AddHandler cgi-script .py

\</Directory\>
</code>

(2) you have given executable permission the python scripts.

To start the app, run index.py and log in with admin or your credentials. 

(3) using the spreadsheet editor requires an installation of EtherCalc.


(c) 2016-2017 Shuo Zhang (@zangsir) and Amir Zeldes (@amir-zeldes)

This work was supported by the [KELLIA](http://kellia.uni-goettingen.de/) project, [NEH](https://www.neh.gov/) grant #HG-229371, co-sponsored by the German [DFG](http://www.dfg.de/).
