-- The client's flow. Owner texts are hers, word for word.
-- Her list names 12 steps; Court Day is the 13th. It is the point 3D "goes back to",
-- and the place results are recorded from. It has no owner text.
insert into stages (code, display_no, name, tone, sort, is_terminal, sends_text, default_template) values
('filed',               '1',    'Filed',                               'neutral', 10,  false, true,  'We filed eviction today for {address}.'),
('court_date_set',      '2',    'Court date set',                      'neutral', 20,  false, true,  'Court is set for {day} at {time} for {address}.'),
('court_day',           '3',    'Court day',                           'neutral', 30,  false, false, null),
('dismissed_paid',      '3A',   'Dismissed and paid',                  'good',    40,  true,  true,  'Good news and congratulations. The case for {address} was dismissed. Your resident paid and will stay.'),
('possession_won',      '3B',   'Possession won',                      'bad',     50,  false, true,  'Court is complete for {address} and we won possession.'),
('continued_pending',   '3C',   'Continued, date pending',             'warn',    60,  false, true,  'The judge continued the case for {address}. No new date yet. We will send it when we have it.'),
('continued_new_date',  '3D',   'Continued, new date set',             'warn',    70,  false, true,  '{address} was continued. A new court date was set, and your team enters it here.'),
('appeal_filed',        'AP',   'Appeal filed',                        'neutral', 80,  false, true,  'An appeal was filed for {address}. The process is paused.'),
('writ_filed',          '4',    'Writ filed, your decision',           'bad',     90,  false, true,  'The writ was filed for {address}. Reply STAY to accept funds and let the resident stay. Reply LOCKOUT to move forward. Please reply by {deadline}.'),
('stay_closed',         'STAY', 'Stay, funds accepted',                'good',    100, true,  true,  'Confirmed. You chose to accept funds for {address}. The resident stays and this case is now closed.'),
('lockout_scheduled',   '5',    'Lockout scheduled',                   'bad',     110, false, true,  'Lockout is scheduled for {address} on {day} at {time}.'),
('lockout_complete',    '6',    'Lockout complete, keys held 7 days',  'bad',     120, false, true,  'Lockout complete for {address}. Possession is granted, and by North Carolina law the keys are held for 7 days.'),
('possession_returned', '7',    'Possession returned, full report coming', 'good', 130, true, true,  'The keys have been turned in and we can now walk {address}. Our marketing team will send you a full report.');

insert into stage_transitions (from_stage, to_stage, label) values
('filed',              'court_date_set',     'Send court date'),
('court_date_set',     'court_day',          'Move to court day'),
('court_day',          'dismissed_paid',     'Dismissed and paid'),
('court_day',          'possession_won',     'Possession won'),
('court_day',          'continued_pending',  'Continued, date pending'),
('court_day',          'continued_new_date', 'Continued, new date set'),
('continued_pending',  'continued_new_date', 'Enter new court date'),
('continued_new_date', 'court_day',          'Back to court day'),
('possession_won',     'writ_filed',         'File writ'),
('possession_won',     'appeal_filed',       'Record appeal'),
('writ_filed',         'stay_closed',        'Owner chose STAY'),
('writ_filed',         'lockout_scheduled',  'Owner chose LOCKOUT'),
('writ_filed',         'appeal_filed',       'Record appeal'),
('lockout_scheduled',  'lockout_complete',   'Lockout complete'),
('lockout_scheduled',  'appeal_filed',       'Record appeal'),
('lockout_complete',   'possession_returned','Keys turned in'),
('appeal_filed',       'possession_won',     'Resume case'),
('appeal_filed',       'writ_filed',         'Resume case'),
('appeal_filed',       'lockout_scheduled',  'Resume case');
