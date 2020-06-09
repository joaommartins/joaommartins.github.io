import json
from pathlib import Path


def parse_jsons(json_folder):
    '''
    
    '''
    # Pre-define fields so we don't have to check in jinja
    # Also gives the allowed filenames for json
    page_data = {
        'header': {'title': 'No header.json file found'},
        'about': {'title': 'No about.json file found'},
        'projects': {'title': 'No projects.json file found'},
        'experiences': {'title': 'No experiences.json file found'},
        'education': {'title': 'No education.json file found'}
    }
    json_files = Path(json_folder).glob('*.json')
    for filename in json_files:
        if filename.stem in page_data.keys():
            with open(filename) as json_file:
                file_contents = json.load(json_file)
            page_data.update({filename.stem: file_contents})
        else:
            # Warn here?
            continue
    return page_data
