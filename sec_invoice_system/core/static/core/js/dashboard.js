/* ══════════════════════════════════════════
   لوحة المتابعة - الرسم البياني اليومي
   ══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
    var contractSelect = document.getElementById('contractFilter');
    var filterForm = document.getElementById('contractFilterForm');

    if (contractSelect && filterForm) {
        contractSelect.addEventListener('change', function () {
            // إعادة تحميل الصفحة حتى تتزامن البطاقات مع الرسم البياني
            filterForm.submit();
        });
    }

    loadChart();
});

function selectedContractId() {
    var el = document.getElementById('contractFilter');
    return el ? el.value : '';
}

function loadChart() {
    var contractId = selectedContractId();
    var url = '/api/daily/';
    if (contractId) {
        url += '?contract=' + encodeURIComponent(contractId);
    }

    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.json();
        })
        .then(renderChart)
        .catch(function (error) {
            console.error('خطأ في تحميل البيانات:', error);
            var notice = document.getElementById('chartUnavailable');
            if (notice) {
                notice.hidden = false;
            }
        });
}

function renderChart(data) {
    var canvas = document.getElementById('dailyChart');
    if (!canvas || typeof Chart === 'undefined') {
        return;
    }

    if (window.dailyChartInstance) {
        window.dailyChartInstance.destroy();
    }

    window.dailyChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'التكلفة اليومية (ر.س)',
                    data: data.costs,
                    backgroundColor: 'rgba(52, 152, 219, 0.7)',
                    borderColor: 'rgba(52, 152, 219, 1)',
                    borderWidth: 1,
                    order: 2
                },
                {
                    label: 'المتراكم (ر.س)',
                    data: data.accumulated,
                    type: 'line',
                    borderColor: 'rgba(231, 76, 60, 1)',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'top',
                    rtl: true,
                    labels: { font: { size: 13 } }
                },
                tooltip: {
                    rtl: true,
                    callbacks: {
                        label: function (context) {
                            var value = Number(context.parsed.y).toLocaleString('ar-SA');
                            return context.dataset.label + ': ' + value + ' ر.س';
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 11 } } },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            return Number(value).toLocaleString('ar-SA');
                        }
                    }
                }
            },
            onClick: function (event, elements) {
                if (elements.length > 0) {
                    var index = elements[0].index;
                    showDayDetails(data.labels[index], data.costs[index]);
                }
            }
        }
    });
}

function showDayDetails(dateLabel, cost) {
    var detailsDiv = document.getElementById('dayDetails');
    var titleEl = document.getElementById('dayTitle');
    var contentEl = document.getElementById('dayContent');

    if (!detailsDiv || !titleEl || !contentEl) {
        return;
    }

    titleEl.textContent = 'تفاصيل يوم ' + dateLabel;
    contentEl.textContent = 'تكلفة اليوم: ' + Number(cost).toLocaleString('ar-SA') + ' ر.س';

    detailsDiv.hidden = false;
    detailsDiv.scrollIntoView({ behavior: 'smooth' });
}
