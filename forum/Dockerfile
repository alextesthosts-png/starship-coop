# Vanguard Wing forum: PHP 8.3 + Apache + SQLite (data lives on the Railway volume at /data)
FROM php:8.3-apache
RUN (a2dismod -f mpm_event mpm_worker || true) && a2enmod mpm_prefork headers \
 && printf '<Directory /var/www/html>\n  FallbackResource /index.php\n  Options -Indexes\n</Directory>\nServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-enabled/forum.conf \
 && echo 'expose_php = Off' > /usr/local/etc/php/conf.d/forum.ini \
 && echo 'upload_max_filesize = 1M' >> /usr/local/etc/php/conf.d/forum.ini
COPY public/ /var/www/html/
COPY src/ /var/www/src/
ENV FORUM_DATA=/data
EXPOSE 8080
# Railway provides $PORT; Apache is pointed at it, and the data folder handed to www-data
CMD ["bash", "-c", "rm -f /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.* && sed -ri \"s/Listen [0-9]+/Listen ${PORT:-8080}/\" /etc/apache2/ports.conf && sed -ri \"s/<VirtualHost \\*:[0-9]+>/<VirtualHost *:${PORT:-8080}>/\" /etc/apache2/sites-available/000-default.conf && mkdir -p /data && chown -R www-data:www-data /data && exec apache2-foreground"]
