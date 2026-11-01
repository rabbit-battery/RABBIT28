from django.shortcuts import render
from django.contrib.auth.decorators import login_required

from .models import Statement
from .forms import TrackStatementForm
from .utils import log_audit, verify_event_chain


@login_required
def statement_track(request):
    """تتبع مستخلص بالرقم مع التحقق من سلامة سلسلة البصمات"""
    result = None
    events = []
    chain_valid = True

    if request.method == 'POST':
        form = TrackStatementForm(request.POST)
        if form.is_valid():
            stmt_number = form.cleaned_data['statement_number']

            log_audit(request, 'track_search', f'بحث عن: {stmt_number}')

            try:
                stmt = Statement.all_objects.get(statement_number=stmt_number)
            except Statement.DoesNotExist:
                result = 'not_found'
            else:
                events = list(stmt.events.all())
                chain_valid = verify_event_chain(stmt)
                result = stmt
    else:
        form = TrackStatementForm()

    return render(request, 'core/statement_track.html', {
        'form': form,
        'result': result,
        'events': events,
        'chain_valid': chain_valid,
    })
