FROM ubuntu:16.04
EXPOSE 80

# install deps
RUN apt update
RUN apt -y install apache2 python python-pip redis-server gzip git curl \
libssl-dev pkg-config build-essential npm libxml2-utils

# add gitdox and give permissions
RUN rm -rf /var/www/html
ADD . /var/www/html
RUN chown -R www-data:www-data /var/www/html
RUN chmod +x /var/www/html/*.py
RUN chmod +x /var/www/html/modules/*.py

RUN pip install -r /var/www/html/requirements.txt

# install ethercalc and run as a service
RUN npm install -g ethercalc
RUN adduser --system --no-create-home --group ethercalc

# enable cgi
RUN a2enmod cgi
RUN echo "                       \n \
<Directory /var/www/html>        \n \
   Options +ExecCGI              \n \
   AddHandler cgi-script .py     \n \
   DirectoryIndex index.py       \n \
</Directory>                     \n \
" >> /etc/apache2/apache2.conf

RUN a2enmod proxy_html proxy_http proxy_wstunnel
# set up a proxy for ethercalc
RUN echo " \n\
<VirtualHost *:80> \n\
	ServerName localhost \n\
\n\
	# Proxy pass to the node.js server (port 8000) \n\
	ProxyPass /ethercalc/ http://127.0.0.1:8000/ \n\
	ProxyPassReverse /ethercalc/ http://127.0.0.1:8000/ \n\
  ProxyPreserveHost On \n\
</VirtualHost> \n\
" >> /etc/apache2/apache2.conf

# against best practices both to (1) not use a different container for each
# service and (2) not to use supervisord to manage the execution of these
# processes. But (1) is too heavy a solution, and (2) seems unnecessary unless
# one of our services leaks memory/is unstable
RUN echo "ln -s /usr/bin/nodejs /usr/bin/node" >> /etc/startup.sh
RUN echo "/usr/bin/redis-server &" >> /etc/startup.sh
RUN echo "/usr/local/bin/ethercalc &" >> /etc/startup.sh
RUN echo "/usr/sbin/apache2ctl -D FOREGROUND" >> /etc/startup.sh
ENTRYPOINT ["/bin/sh", "/etc/startup.sh"]
