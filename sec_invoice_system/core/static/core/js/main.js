/* ══════════════════════════════════════════
   سكربت عام - نظام مستخلصات العقد الموحد
   ══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

    // إخفاء الرسائل تلقائياً بعد 6 ثوانٍ
    var alerts = document.querySelectorAll('.messages .alert');
    alerts.forEach(function (alert) {
        setTimeout(function () {
            alert.style.transition = 'opacity 0.5s';
            alert.style.opacity = '0';
            setTimeout(function () {
                alert.remove();
            }, 500);
        }, 6000);
    });

    // تأكيد الحذف عبر data-confirm
    var confirmForms = document.querySelectorAll('form[data-confirm]');
    confirmForms.forEach(function (form) {
        form.addEventListener('submit', function (e) {
            var message = form.getAttribute('data-confirm') || 'هل أنت متأكد؟';
            if (!window.confirm(message)) {
                e.preventDefault();
            }
        });
    });

    // إضافة علامة للحقول المطلوبة
    var requiredInputs = document.querySelectorAll('input[required], select[required], textarea[required]');
    requiredInputs.forEach(function (input) {
        var group = input.closest('.form-group');
        if (group) {
            var labelEl = group.querySelector('label');
            if (labelEl && labelEl.textContent.indexOf('*') === -1) {
                labelEl.textContent += ' *';
            }
        }
    });
});
