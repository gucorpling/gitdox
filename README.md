# GitDOX

GitDOX is an online editor for version controlled collaborative XML, spreadsheet and specialized annotation layer editing used for building linguistic corpora.

*The main branch currently tracks the React based GitDOX v2.X - for older versions using EtherCalc see the legacy branch*

The user interface is built using React, integrating an XML editor based on [CodeMirror](https://codemirror.net) and a spreadsheet interface derived from [x-data-spreadsheet](https://github.com/myliang/x-spreadsheet). A Python Pydantic API controls the backend, with Redis as a database and GitHub for remote storage. 

GitDOX is developed by the [Corpling lab](https://gucorpling.org/corpling/) at Georgetown University. It is in active use by [Coptic SCRIPTORIUM](https://copticscriptorium.org/) as an xml editor/transcription tool/annotation environment for Coptic texts, and by the [GUM corpus](https://gucorpling.org/gum/) to build a multilayer corpus of English Web genres.

Some scenarios when GitDOX is helpful:

  * Many annotators, limited training
    * You want to just give annotators a login (browser based)
    * You use complex **XML** validation schemas and update them for all users
    * You use **spreadsheets** to annotate and have annotators already familiar with tools like Excel
    * You're doing named entity, coreference or entity linking annotation
  * You need version control and like GitHub
    * Use commit history from GitDOX directly on GitHub
    * Link annotator accounts to GitHub accounts
    * Make conflicts impossible for inexperienced Git users (each committed version overwrites previous doc, but remains diffable)
  * Using a dashboard to coordinate annotation
    * You can use validation rules and assignments to check document status
    * Built in metadata and export functions to manage data releases
    * Combined with version control, you can track annotator progress towards data release
 
For more information see https://gucorpling.org/gitdox/

## Installation

The main app configuration can be adjusted in the main project based on the project name as in `<NAME>-config.yaml`. An example configuration called example-config.yaml is provided.

### Local testing

  * Backend
    * Install redis and ensure the service is running (by default on port :6379)
    * Ensure Python is installed with all requirements in `requirements.txt`
    * (optional) Edit api.py to set your own master password in `MASTER_INIT_SECRET` for initializing a new project (default: "my_super_secret_master_password")
    * In backend/, Run `python api.py`
    * Your backend service will now be running at port :8008
  * Frontend
    * Ensure npm/vite is installed
    * Set a project name for your instance in `FRONTEND_PROJECT_NAME` within App.jsx
    * Run npm run dev
    * Open http://localhost:5173 in your browser
    * Initialize the project by clicking "Need to initialize first run?", then filling in the user name, password and master password and clicking "Bootstrap DB"

### Server installation

  * Ensure Python and all requirements in `requirements.txt` are installed
  * Install and run redis (by default on port :6379)
  * Edit api.py to set your own master password in `MASTER_INIT_SECRET` for initializing a new project
  * Copy the files in backend/ to your server into a separate folder, which is not publicly accessible
  * Setup a service to run and automatically restart `python api.py`
  * (optional) If you want to run GitDOX in a subfolder (like `server.com/gitdox/myproject/` instead of directly as `server.com`):
    * Modify `FRONTEND_BASE_PATH_FALLBACK` in App.jsx to match your folder name WITHOUT leading or trailing slashes (e.g. "gitdox/myproject")
    * Modify `base` in `vite.config.js` to match your folder name WITH leading and traling slashes (e.g. `base: '/gitdox2/scriptorium/'`)
  * Run `npm run build`
  * Copy the files in `dist/` to your server folder
  * Setup a proxy pass on your webserver to route all traffix to /gdapi/ into port :8008 and back (see example below)
  * Setup webserver access to the public path of your app folder (see example below)

### Example server files using apache

#### Front end config
```conf
<Directory "/var/www/html/gitdox/scriptorium/">
  AllowOverride None
  Require all granted
  Options +FollowSymLinks

  DirectoryIndex index.html
  RewriteEngine On
  RewriteBase /gitdox/scriptorium/

  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]

  RewriteRule ^ index.html [L]
</Directory>
```

#### Proxypass config
```conf
<VirtualHost *:80>
  ServerName tools.copticscriptorium.org

  ProxyPass /gdapi/ http://127.0.0.1:8008/
  ProxyPassReverse /gdapi/ http://127.0.0.1:8008/

</VirtualHost>
```

## Running multiple instances

Option 1 (No Rebuilding): If you build this React app once, you can host it in multiple server directories. For each directory, just open the static public/index.html file and add:
HTML

<script>
  window.GITDOX_PROJECT = "your_project_name";
</script>
   The React app will detect this at runtime and pass it to the backend to get the right `.yaml` config file.

Option 2 (Hardcoded): If you are running multiple isolated deployments with different codebases anyway, you can just change FRONTEND_PROJECT_NAME = '...'; directly in `App.jsx`.

# Credits

(c) 2016-2026 Shuo Zhang (@zangsir), Amir Zeldes (@amir-zeldes), and Luke Gessler (@lukegessler)

This work was originally supported by the [KELLIA](http://kellia.uni-goettingen.de/) project, [NEH](https://www.neh.gov/) grant #HG-229371, co-sponsored by the German [DFG](http://www.dfg.de/) and NEH grant #HAA-261271-18.
