from django.urls import path
from django.contrib.auth import views as auth_views

from . import views, views_statements, views_tracking, views_users

urlpatterns = [
    # الدخول والخروج
    path('login/', auth_views.LoginView.as_view(
        template_name='core/login.html'), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('password/change/', views.password_change_view, name='password_change'),

    # لوحة المتابعة
    path('', views.dashboard, name='dashboard'),

    # العقود
    path('contracts/', views.contract_list, name='contracts'),
    path('contracts/new/', views.contract_form, name='contract_new'),
    path('contracts/<int:pk>/edit/', views.contract_form, name='contract_edit'),

    # بنود الأسعار
    path('contracts/<int:contract_id>/items/', views.price_items, name='price_items'),
    path('contracts/<int:contract_id>/items/new/', views.price_item_form, name='price_item_new'),

    # الفنيون
    path('technicians/', views.technician_list, name='technicians'),
    path('technicians/new/', views.technician_form, name='technician_new'),

    # العطل
    path('holidays/', views.holiday_list, name='holidays'),
    path('holidays/new/', views.holiday_form, name='holiday_new'),

    # المهام
    path('tasks/', views.task_list, name='tasks'),
    path('tasks/new/', views.task_form, name='task_new'),
    path('tasks/<int:pk>/edit/', views.task_form, name='task_edit'),
    path('tasks/<int:pk>/delete/', views.task_delete, name='task_delete'),
    path('tasks/import/', views.task_import, name='task_import'),

    # المستخلصات
    path('statements/', views_statements.statement_list, name='statements'),
    path('statements/generate/', views_statements.statement_generate, name='statement_generate'),
    path('statements/<int:pk>/', views_statements.statement_detail, name='statement_detail'),
    path('statements/<int:pk>/review/', views_statements.statement_review, name='statement_review'),
    path('statements/<int:pk>/approve/', views_statements.statement_approve, name='statement_approve'),
    path('statements/<int:pk>/pay/', views_statements.statement_pay, name='statement_pay'),
    path('statements/<int:pk>/notes/', views_statements.statement_notes, name='statement_notes'),
    path('statements/<int:pk>/delete/', views_statements.statement_delete, name='statement_delete'),
    path('statements/<int:pk>/pdf/', views_statements.statement_pdf, name='statement_pdf'),
    path('statements/<int:pk>/xlsx/', views_statements.statement_xlsx, name='statement_xlsx'),

    # التتبع
    path('statements/track/', views_tracking.statement_track, name='statement_track'),

    # المقارنة
    path('reports/compare/', views_statements.statement_compare, name='statement_compare'),

    # API
    path('api/daily/', views.api_daily_costs, name='api_daily_costs'),

    # المستخدمون
    path('users/', views_users.user_list, name='users'),
    path('users/new/', views_users.user_create, name='user_create'),
    path('users/<int:pk>/edit/', views_users.user_edit, name='user_edit'),
    path('users/<int:pk>/reset-password/', views_users.user_reset_password, name='user_reset_password'),

    # التوقيع
    path('profile/signature/', views_users.signature_upload, name='signature_upload'),

    # 2FA
    path('2fa/setup/', views.setup_2fa, name='setup_2fa'),
    path('2fa/verify/', views.verify_2fa, name='verify_2fa'),
]
