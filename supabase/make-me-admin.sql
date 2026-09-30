-- Run this AFTER you have created your own user in
-- Authentication → Users → "Add user" (tick "Auto Confirm User").
-- Change the email below if you used a different one.

insert into public.profiles (id, email, display_name, role, unit)
select id, email, 'Tom Mennella', 'admin', 'Arts and Sciences'
from auth.users
where email = 'thomas.mennella@wne.edu'
on conflict (id) do update set role = 'admin', active = true;

-- Should return one row with role = admin:
select email, role, active from public.profiles where role = 'admin';
