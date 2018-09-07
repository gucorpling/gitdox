import os
import sys
from passlib.apps import custom_app_context as pwd_context
import github3
import time

errors = False

def migrate_user_config(path, project, ConfigObj, pass_dec, pass_enc):
    global errors
    o = ConfigObj(path)
    if 'password' in o and o['password'] != "":
        old = pass_dec(o['password'])[0]
        o['password'] = pass_enc(pwd_context.hash(old, salt=""))
        o.write()
        print "Successfully migrated password for " + path

    if 'git_password' in o and o['git_password'] != "" \
       and 'git_username' in o and o['git_username'] != "":
        old = pass_dec(o['git_password'])[0]
        username = o['git_username']
        note = project + ", " + time.ctime()
        try:
            auth = github3.authorize(username, old, ['repo'], note, "")
            o['git_token'] = auth.token
            o['git_id'] = auth.id

            del o['git_password']
            print "Successfully migrated git credentials for " + path
            o.write()
        except:
            errors = True
            print "ERROR: GitHub password migration failed for " + path
            print "| To fix this error do the following: "
            print "|   1. Ask the user to visit https://github.com/settings/tokens"
            print "|      and generate a new token with all the 'repo' box"
            print "|      checked, with the description being anything."
            print "|   2. Ask the user to give you the generated token"
            print "|   3. Manually edit the user's config and add the line:"
            print "|        git_token = <YOUR USER'S NUMBER> "
            print "+---------------------------------------------------------------"


def main():
    wrong_dir_msg = """
It looks like you are not running this script from the base
folder of your GitDox install. Please move to your GitDox
installation root and run this script again by typing:

  python migrations/from_0.9.1.py

"""
    already_run_msg = """
You have already run this migration. If you think you need to
run it again for some reason, please contact the maintainers"
of GitDox for instructions on how to proceed.
"""

    if 'README.md' not in os.listdir("."):
        print wrong_dir_msg
        sys.exit(1)

    if 'users' not in os.listdir("."):
        print wrong_dir_msg
        sys.exit(1)

    # the danger of running this migration twice is that the passwords would
    # be double hashed, so check for it
    if os.path.exists('migrations/.0.9.1'):
        print already_run_msg
        sys.exit(2)

    try:
        # need to do this ugly hack because you can't easily do relative import in a python script
        oldpath = sys.path
        sys.path.append(os.path.abspath('modules'))

        from dataenc import pass_enc, pass_dec
        from configobj import ConfigObj

        config = ConfigObj('users' + os.sep + 'config.ini')
        project = config["project"]
        for _, _, files in os.walk('users'):
            for cfgname in files:
                if cfgname.endswith('.ini'):
                    migrate_user_config('users' + os.sep + cfgname, project, ConfigObj, pass_dec, pass_enc)
    finally:
        sys.path = oldpath

    # make sure we don't run this again
    with open('migrations/.0.9.1','w') as f:
        f.write(".")

    if errors:
        print "Successfully completed migration, but with errors. Please inspect output for instructions."
    else:
        print "Successfully completed migration."

if __name__ == '__main__':
    main()
