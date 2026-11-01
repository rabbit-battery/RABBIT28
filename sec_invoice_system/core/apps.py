from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'
    verbose_name = 'نظام المستخلصات'

    def ready(self):
        from .signals import register
        register()
