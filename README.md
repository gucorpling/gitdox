# GitDox
GitDox is an online editor for version controlled XML editing.

The editor interface is based on [CodeMirror](https://codemirror.net). GitHub is used as a remote backend, and SQLite is used for local storage. 

GitDox is used by [Coptic SCRIPTORIUM](http://copticscriptorium.org/) as an xml editor/transcription tool for Coptic texts. 

# Installation
The following instructions assume you are installing on a recent (16.04-18.04) version of Ubuntu.

## Install Redis
Ethercalc has an optional dependency on Redis. We assume you will be using Redis
for these instructions.

```bash
sudo apt update
sudo apt install redis-server
redis-cli ping #=> "PONG", if all has gone well
```
 
## Install Ethercalc

```bash
# install deps
sudo apt install gzip git curl python libssl-dev pkg-config build-essential npm
# install ethercalc
sudo npm install -g ethercalc
# start ethercalc in background and continue using terminal
ethercalc &
```

By default, Ethercalc runs on port 8000.

## Install and Configure Apache2

Install, and enable CGI module

```bash
sudo apt install apache2
# enable CGI module and reload
sudo a2enmod cgi
```

Add these lines to `/etc/apache2/apache2.conf`. This tells Apache to execute
Python files that the client requests, and to serve `index.py` by default. (Note that we're assuming you're installing GitDox under `/var/www/html`--you should replace this path with the one you're going to install under.)

```xml
<Directory "/var/www/html">
	Options +ExecCGI
	AddHandler cgi-script .py
	DirectoryIndex index.py
</Directory>
```

Restart Apache:

```
sudo service apache2 restart
```

## Install GitDox
Decide where you want GitDox to live under your Apache directories. In these
instructions we'll assume it's `/var/www/html`

1. Install xmllint for xml validation:

```bash
sudo apt install libxml2-utils
```

2. Execute the following to set up GitDox's files:

```bash
# clear /var/www/html and clone gitdox to it, changing ownership to www-data
sudo rm -rf /var/www/html
sudo git clone https://github.com/gucorpling/gitdox.git /var/www/html
sudo chown -R www-data:www-data /var/www/html

# allow apache to execute python files
sudo chmod +x /var/www/html/*.py
sudo chmod +x /var/www/html/modules/*.py

# install dependencies--use pip
sudo apt install python-pip
sudo pip install -r /var/www/html/requirements.txt
```

3. Edit the contents of `users/config.ini` to your liking. In particular, pay
   attention to `xml_nlp_api` and `spreadsheet_nlp_api` if you plan to make use
   of those features.

4. Modify the value of `ether_url` in `paths.py` so that it reflects where
   GitDox can find your Ethercalc service over HTTP. By default, it is on your
   local machine on port 8000, so the line in `paths.py` would read `ether_url =
   "http://localhost/:8000"`.

5. Navigate to `http://localhost`. The default login is `admin`, `pass1`.


# Credits

(c) 2016-2018 Shuo Zhang (@zangsir), Amir Zeldes (@amir-zeldes), and Luke Gessler (@lukegessler)

This work was supported by the [KELLIA](http://kellia.uni-goettingen.de/) project, [NEH](https://www.neh.gov/) grant #HG-229371, co-sponsored by the German [DFG](http://www.dfg.de/).
