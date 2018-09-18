# GitDox
GitDox is an online editor for version controlled XML editing.

The editor interface is based on [CodeMirror](https://codemirror.net). GitHub is used as a remote backend, and SQLite is used for local storage. 

GitDox is used by [Coptic SCRIPTORIUM](http://copticscriptorium.org/) as an xml editor/transcription tool for Coptic texts. 

# Installation
You have three choices:

1. Pull the latest GitDox Docker image
2. Build and run a GitDox Docker image
3. Manually install GitDox on your machine 

Unless you have a good reason to do (2) or (3), we recommend you do (1).

# Pull the latest Docker image
**Note:** currently, only the `gucorpling/gitdox:dev` image is available. We
hope to provide a stable release soon.

First, [install Docker](https://docs.docker.com/install/). You may be able to
install it using your platform's package manager.

```bash
docker run -dit --restart unless-stopped --name gitdox-dev -p 5000:80 gucorpling/gitdox:dev
```

GitDox should now be running the docker container you've set up, and you may
visit `http://localhost:5000` on your machine to verify that it works. GitDox should
now always be running on your machine, even if you reboot it. If for some reason
you need to stop it manually, you may do so:

```bash
docker stop gitdox
# since you stopped it manually, it will no longer start automatically, even on
# reboot. to start again:
docker start gitdox
```

If you need to manually edit GitDox files, you may start a
bash session inside of the Docker container:

```bash
docker exec -it gitdox-instance bash
# now you are inside--install vim so you can edit files
apt install vim 
cd /var/www/html
vim user/admin.ini # or whatever you need to edit
```

If you anticipate that you will need to heavily modify GitDox's files, you may wish 
to have your GitDox folders live in your host machine's filesystem:

```bash
sudo git clone https://github.com/gucorpling/gitdox /opt/gitdox
sudo chown -R www-data:www-data /opt/gitdox
docker run -dit --restart unless-stopped --name gitdox -v /opt/gitdox:/var/www/html -p 5000:80 gucorpling/gitdox:dev gitdox
```

These commands install GitDox under `/opt` in your host machine and allows you to modify them just as you would modify any other file on your machine. But in the Docker command, with the `-v` flag we tell it to mount this folder as `/var/www/html` in the container's filesystem. The files are shared bidirectionally: changes made in the container will flow to the host, and vice versa.

# Build and run a Docker image
First, [install Docker](https://docs.docker.com/install/). You may be able to
install it using your platform's package manager.

Run the following code:

```bash
git clone https://github.com/gucorpling/gitdox ~/gitdox
# compile the docker image
docker build -t gitdox .
# launch the image on your machine, mapping the image's port 80 to your machine's 80
docker run -dit --restart unless-stopped --name gitdox -p 5000:80 gitdox
```

GitDox should now be running the docker container you've set up, and you may
visit `http://localhost:5000` on your machine to verify that it works. GitDox should
now always be running on your machine, even if you reboot it. If for some reason
you need to stop it manually, you may do so:

```bash
docker stop gitdox
# since you stopped it manually, it will no longer start automatically, even on
# reboot. to start again:
docker start gitdox
```

If for whatever reason you need to manually edit GitDox files, you may start a
bash session inside of the Docker container:

```bash
docker exec -it gitdox-instance bash
# now you are inside--install vim so you can edit files
apt install vim 
cd /var/www/html
vim user/admin.ini # or whatever you need to edit
```

# Manual Installation
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

4. Modify the value of `ether_url` in `users/config.ini` so that it reflects where
   GitDox can find your Ethercalc service over HTTP. It defaults to assuming
   that you will serve Ethercalc via reverse proxy into a subdirectory of your
   website, /ethercalc/. If you want to serve it over its original port, you
   should change it to something like `yourdomain.com:8000`, and if you want to
   serve it over a subdomain, change it to something like
   `your.subdomain.yourdomain.com`.

5. Navigate to `http://localhost`. The default login is `admin`, `pass1`.


# Credits

(c) 2016-2018 Shuo Zhang (@zangsir), Amir Zeldes (@amir-zeldes), and Luke Gessler (@lukegessler)

This work was supported by the [KELLIA](http://kellia.uni-goettingen.de/) project, [NEH](https://www.neh.gov/) grant #HG-229371, co-sponsored by the German [DFG](http://www.dfg.de/).
