FROM ubuntu:18.04
EXPOSE 80

# install deps
RUN apt update
RUN apt -y install apache2 python python-pip redis-server gzip git curl libssl-dev pkg-config build-essential npm libxml2-utils git

# pull gitdox and give permissions
RUN rm -rf /var/www/html
RUN git clone https://github.com/gucorpling/gitdox.git /var/www/html
RUN chown -R www-data:www-data /var/www/html
RUN chmod +x /var/www/html/*.py
RUN chmod +x /var/www/html/modules/*.py

# keep these in sync with requirements.txt
RUN pip install lxml requests github3.py==0.9.3 passlib

# start ethercalc
RUN npm install -g ethercalc
RUN ethercalc &

# enable cgi
RUN a2enmod cgi
RUN echo "                       \n \
<Directory /var/www/html>        \n \
   Options +ExecCGI              \n \
   AddHandler cgi-script .py     \n \
   DirectoryIndex index.py       \n \
</Directory>                     \n \
" >> /etc/apache2/apache2.conf
RUN service apache2 restart

CMD /usr/sbin/apache2ctl -D FOREGROUND
