import unittest
from automation.mobile_monitor import blog_article, people_from_urls, summarize_groups, recommend, GROUPS

def ten(*custom):
    rest=[f'https://blog.naver.com/external_{i}/{123456789000+i}' for i in range(10)]
    for rank,person in custom:
        rest[rank-1]=f'https://m.blog.naver.com/{person}/{123456789000+rank}'
    return rest

class MonitorTests(unittest.TestCase):
    def test_normalize_posts_not_profiles(self):
        self.assertEqual(blog_article('https://m.blog.naver.com/esim99_/224465701947')['id'],'esim99_')
        self.assertIsNone(blog_article('https://blog.naver.com/esim99_'))
        self.assertIsNone(blog_article('https://phishing.com/m.blog.naver.com/esim99_/224465701947'))
        self.assertEqual(blog_article('https://blog.naver.com/PostView.naver?blogId=jjuny1253&logNo=224465701947')['id'], 'jjuny1253')

    def test_same_person_multiple_blogs(self):
        found=people_from_urls(ten((1,'esim99_'),(3,'esim87_'),(7,'ntelecom59')))
        self.assertEqual([x['rank'] for x in found['영은']],[1,3])
        self.assertEqual([x['rank'] for x in found['하루']],[7])

    def test_matches_two_missing_and_pairs(self):
        r={}
        for name,queries in GROUPS.items():
            if name=='KT바로유심':
                values=ten((3,'esim99_'),(7,'ntelecom59'))
            elif name=='LG모두의 원칩':
                values=ten((1,'carrotmobile_'),(6,'jjuny1253'))
            else:
                values=ten((1,'lifeon5g_'),(2,'esim99_'),(3,'ntelecom59'),(4,'jjuny1253'))
            for q in queries:r[q]={'status':'auto_observed','urls':values}
        groups=summarize_groups(r)
        self.assertEqual(groups['KT바로유심']['missing'],['건호','수진'])
        self.assertEqual(groups['LG모두의 원칩']['missing'],['영은','하루'])
        ans=recommend(groups)
        self.assertTrue(ans['ready'])
        self.assertEqual(ans['assignments'][0]['people'],['건호','수진'])
        self.assertEqual(ans['assignments'][1]['people'],['영은','하루'])

    def test_unverified_not_absent(self):
        r={q:{'status':'auto_observed','urls':ten()} for qs in GROUPS.values() for q in qs}
        del r['바로유심']
        groups=summarize_groups(r)
        self.assertFalse(groups['KT바로유심']['complete'])
        self.assertEqual(groups['KT바로유심']['missing'],[])

    def test_prior_drop_is_priority(self):
        r={q:{'status':'auto_observed','urls':ten()} for qs in GROUPS.values() for q in qs}
        prev={'groups':{'KT바로유심':{'complete':True,'matches':{'하루':[{'rank':2}]}}}}
        groups=summarize_groups(r,prev)
        self.assertIn('하루',groups['KT바로유심']['dropped'])
        ans=recommend(groups)
        self.assertEqual(ans['assignments'][0]['keyword'],'KT바로유심')
        self.assertIn('하루',ans['assignments'][0]['people'])

if __name__=='__main__':unittest.main()
