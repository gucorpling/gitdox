# gitdox
GitDOX is an online editor for version controlled XML editing.

The editor interface is based on [CodeMirror](https://codemirror.net). GitHub is used as a remote backend, and SQLite is used for local storage. 

GitDOX is used by [Coptic SCRIPTORIUM](http://copticscriptorium.org/) as an xml editor/transcription tool for Coptic texts. 

# Installation
The following instructions assume you are installing on a recent version of
Ubuntu.

## Install Redis
Ethercalc has an optional dependency on Redis. We assume you will be using Redis
for these instructions.

1. `sudo add-apt-repository ppa:rwky/redis`
2. `sudo apt-get update`
3. `sudo apt-get install redis-server`
4. Ensure you get a "PONG" back from Redis: `redis-cli ping`

## Install Ethercalc

1. `sudo apt-get install gzip git curl python libssl-dev pkg-config build-essential`
2. `sudo npm install -g ethercalc`
3. Start Ethercalc: `ethercalc`

By default, Ethercalc runs on port 8000.

## Install GitDOX

1. Install Apache 2, if necessary: `sudo apt-get install apache2`
2. Clone GitDOX somewhere Apache can see it, like `/var/www/html`: `git clone https://github.com/gucorpling/gitdox.git /var/www/html`
3. Allow permission to execute top-level Python files: `sudo chmod +x /var/www/html/*.py`
4. Edit `/etc/apache2/apache2.conf` and allow Python CGI scripts for the
   directory you installed GitDOX under:

<code>
\<Directory "/Applications/MAMP/htdocs/gitdox"\>
    Options +ExecCGI
    AddHandler cgi-script .py
\</Directory\>
</code>

5. Navigate to `localhost/index.py` in a web browser. 

(3) using the spreadsheet editor requires an installation of EtherCalc.


(c) 2016-2017 Shuo Zhang (@zangsir) and Amir Zeldes (@amir-zeldes)

This work was supported by the [KELLIA](http://kellia.uni-goettingen.de/) project, [NEH](https://www.neh.gov/) grant #HG-229371, co-sponsored by the German [DFG](http://www.dfg.de/).
